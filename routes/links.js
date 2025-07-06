const express = require('express');
const router = express.Router();
const Link = require('../models/Link');
const User = require('../models/User');
const Team = require('../models/Team');
const { requireTeamMembership } = require('../middleware/auth');
const Joi = require('joi');

// Validation schemas
const createLinkSchema = Joi.object({
  teamId: Joi.string().required(),
  title: Joi.string().required().min(3).max(200),
  purpose: Joi.string().required().max(1000),
  participants: Joi.array().items(Joi.string()).min(1).required(),
  meetingType: Joi.string().valid('QUICK_SYNC', 'REVIEW', 'PLANNING', 'DECISION', 'BRAINSTORM', 'STATUS_UPDATE').required(),
  scheduledAt: Joi.date().optional(),
  priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'CRITICAL').default('MEDIUM'),
  tags: Joi.array().items(Joi.string().max(50))
});

const updateLinkSchema = Joi.object({
  title: Joi.string().min(3).max(200),
  purpose: Joi.string().max(1000),
  status: Joi.string().valid('PENDING', 'COMPLETE', 'DELAYED'),
  scheduledAt: Joi.date(),
  notes: Joi.string().max(2000),
  priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'),
  tags: Joi.array().items(Joi.string().max(50))
});

const addOutcomeSchema = Joi.object({
  type: Joi.string().valid('DECISION', 'ACTION_ITEM', 'BLOCKER', 'INSIGHT', 'NEXT_STEPS').required(),
  description: Joi.string().required().max(500),
  assignedTo: Joi.string().optional(),
  dueDate: Joi.date().optional()
});

// GET /api/links - Get user's links
router.get('/', async (req, res) => {
  try {
    // req.user contains Google token payload, not our database user
    const googleUser = req.user;
    
    // Find user in our database
    const user = await User.findOne({ email: googleUser.email });
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User profile not found'
      });
    }
    
    const { status, teamId, limit = 20 } = req.query;
    
    // Build query
    const query = {
      'participants.userId': user._id
    };
    
    if (status) query.status = status;
    if (teamId) query.team = teamId;
    
    const links = await Link.find(query)
      .populate('participants.userId', 'name email avatar department designation')
      .populate('team', 'name productName')
      .populate('outcomes.assignedTo', 'name email avatar')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));
    
    // After populating participants.userId, ensure every user has a 'name' field
    if (Array.isArray(links)) {
      links.forEach(link => {
        if (Array.isArray(link.participants)) {
          link.participants.forEach(p => {
            if (p.userId && !p.userId.name) {
              if (p.userId.email) {
                p.userId.name = p.userId.email.split('@')[0];
              } else {
                p.userId.name = 'Unknown';
              }
            }
          });
        }
      });
    } else if (links && Array.isArray(links.participants)) {
      links.participants.forEach(p => {
        if (p.userId && !p.userId.name) {
          if (p.userId.email) {
            p.userId.name = p.userId.email.split('@')[0];
          } else {
            p.userId.name = 'Unknown';
          }
        }
      });
    }
    
    // After populating participants.userId, add a debug log
    if (Array.isArray(links)) {
      links.forEach(link => {
        if (Array.isArray(link.participants)) {
          console.log('Populated participants for link', link._id, ':', link.participants.map(p => p.userId));
        }
      });
    } else if (links && Array.isArray(links.participants)) {
      console.log('Populated participants for link', links._id, ':', links.participants.map(p => p.userId));
    }
    
    res.json({
      success: true,
      data: links,
      count: links.length
    });
  } catch (error) {
    console.error('Error fetching links:', error);
    res.status(500).json({
      error: 'Failed to fetch links',
      message: error.message
    });
  }
});

// POST /api/links - Create a new link
router.post('/', async (req, res) => {
  try {
    // Validate request body
    const { error, value } = createLinkSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        message: error.details[0].message
      });
    }
    
    // req.user contains Google token payload, not our database user
    const googleUser = req.user;
    
    // Find user in our database
    const user = await User.findOne({ email: googleUser.email });
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User profile not found'
      });
    }
    
    const { teamId, title, purpose, participants, meetingType, scheduledAt, priority, tags } = value;
    const initiatorId = user._id;
    
    // Verify team membership
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({
        error: 'Team not found',
        message: 'The specified team does not exist'
      });
    }
    
    const isMember = team.members.find(member => 
      member.userId.toString() === initiatorId.toString()
    );
    
    if (!isMember) {
      return res.status(403).json({
        error: 'Team access denied',
        message: 'You must be a member of the team to create links'
      });
    }
    
    // Verify participants are team members
    const validParticipants = [initiatorId.toString()]; // Include initiator
    for (const participantId of participants) {
      const participant = team.members.find(member => 
        member.userId.toString() === participantId
      );
      if (participant) {
        validParticipants.push(participantId);
      }
    }
    
    // Create link
    const link = new Link({
      title,
      purpose,
      team: teamId,
      meetingType,
      scheduledAt,
      priority,
      tags
    });
    
    // Add participants
    validParticipants.forEach((participantId, index) => {
      const role = index === 0 ? 'INITIATOR' : 'PARTICIPANT';
      link.addParticipant(participantId, role);
    });
    
    await link.save();
    
    // Update team stats
    team.updateStats(1, 0);
    await team.save();
    
    // Update user stats
    await User.findByIdAndUpdate(initiatorId, {
      $inc: { 'stats.linksCreated': 1 }
    });
    
    // Populate data for response
    await link.populate('participants.userId', 'name email avatar department designation');
    await link.populate('team', 'name productName');
    
    res.status(201).json({
      success: true,
      message: 'Link created successfully',
      data: link
    });
  } catch (error) {
    console.error('Error creating link:', error);
    res.status(500).json({
      error: 'Failed to create link',
      message: error.message
    });
  }
});

// GET /api/links/:linkId - Get link details
router.get('/:linkId', async (req, res) => {
  try {
    const { linkId } = req.params;
    
    // req.user contains Google token payload, not our database user
    const googleUser = req.user;
    
    // Find user in our database
    const user = await User.findOne({ email: googleUser.email });
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User profile not found'
      });
    }
    
    const link = await Link.findById(linkId)
      .populate('participants.userId', 'name email avatar department designation')
      .populate('team', 'name productName')
      .populate('outcomes.assignedTo', 'name email avatar');
    
    if (!link) {
      return res.status(404).json({
        error: 'Link not found',
        message: 'The requested link does not exist'
      });
    }
    
    // Check if user is a participant
    const isParticipant = link.participants.some(p => 
      p.userId._id.toString() === user._id.toString()
    );
    
    if (!isParticipant) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have access to this link'
      });
    }
    
    // After populating participants.userId, ensure every user has a 'name' field
    if (Array.isArray(link.participants)) {
      link.participants.forEach(p => {
        if (p.userId && !p.userId.name) {
          if (p.userId.email) {
            p.userId.name = p.userId.email.split('@')[0];
          } else {
            p.userId.name = 'Unknown';
          }
        }
      });
    } else if (link && link.participants && !link.participants.name) {
      if (link.participants.email) {
        link.participants.name = link.participants.email.split('@')[0];
      } else {
        link.participants.name = 'Unknown';
      }
    }
    
    res.json({
      success: true,
      data: link
    });
  } catch (error) {
    console.error('Error fetching link:', error);
    res.status(500).json({
      error: 'Failed to fetch link',
      message: error.message
    });
  }
});

// PUT /api/links/:linkId - Update link
router.put('/:linkId', async (req, res) => {
  try {
    const { linkId } = req.params;
    
    // req.user contains Google token payload, not our database user
    const googleUser = req.user;
    
    // Find user in our database
    const user = await User.findOne({ email: googleUser.email });
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User profile not found'
      });
    }
    
    // Validate request body
    const { error, value } = updateLinkSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        message: error.details[0].message
      });
    }
    
    const link = await Link.findById(linkId);
    if (!link) {
      return res.status(404).json({
        error: 'Link not found',
        message: 'The requested link does not exist'
      });
    }
    
    // Check if user is a participant
    const isParticipant = link.participants.some(p => 
      p.userId.toString() === user._id.toString()
    );
    
    if (!isParticipant) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have access to this link'
      });
    }
    
    // Update link
    Object.assign(link, value);
    await link.save();
    
    // Populate data for response
    await link.populate('participants.userId', 'name email avatar department designation');
    await link.populate('team', 'name productName');
    await link.populate('outcomes.assignedTo', 'name email avatar');
    
    // After populating participants.userId, ensure every user has a 'name' field
    if (Array.isArray(link.participants)) {
      link.participants.forEach(p => {
        if (p.userId && !p.userId.name) {
          if (p.userId.email) {
            p.userId.name = p.userId.email.split('@')[0];
          } else {
            p.userId.name = 'Unknown';
          }
        }
      });
    } else if (link && link.participants && !link.participants.name) {
      if (link.participants.email) {
        link.participants.name = link.participants.email.split('@')[0];
      } else {
        link.participants.name = 'Unknown';
      }
    }
    
    res.json({
      success: true,
      message: 'Link updated successfully',
      data: link
    });
  } catch (error) {
    console.error('Error updating link:', error);
    res.status(500).json({
      error: 'Failed to update link',
      message: error.message
    });
  }
});

// POST /api/links/:linkId/start - Start meeting
router.post('/:linkId/start', async (req, res) => {
  try {
    const { linkId } = req.params;
    
    // req.user contains Google token payload, not our database user
    const googleUser = req.user;
    
    // Find user in our database
    const user = await User.findOne({ email: googleUser.email });
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User profile not found'
      });
    }
    
    const link = await Link.findById(linkId);
    if (!link) {
      return res.status(404).json({
        error: 'Link not found',
        message: 'The requested link does not exist'
      });
    }
    
    // Check if user is a participant
    const isParticipant = link.participants.some(p => 
      p.userId.toString() === user._id.toString()
    );
    
    if (!isParticipant) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have access to this link'
      });
    }
    
    if (link.status !== 'SCHEDULED' && link.status !== 'PENDING') {
      return res.status(400).json({
        error: 'Invalid status',
        message: 'Meeting can only be started when status is SCHEDULED or PENDING'
      });
    }
    
    link.startMeeting();
    await link.save();
    
    res.json({
      success: true,
      message: 'Meeting started successfully',
      data: link
    });
  } catch (error) {
    console.error('Error starting meeting:', error);
    res.status(500).json({
      error: 'Failed to start meeting',
      message: error.message
    });
  }
});

// POST /api/links/:linkId/complete - Complete meeting
router.post('/:linkId/complete', async (req, res) => {
  try {
    const { linkId } = req.params;
    const { duration, notes } = req.body;
    
    // req.user contains Google token payload, not our database user
    const googleUser = req.user;
    
    // Find user in our database
    const user = await User.findOne({ email: googleUser.email });
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User profile not found'
      });
    }
    
    const link = await Link.findById(linkId);
    if (!link) {
      return res.status(404).json({
        error: 'Link not found',
        message: 'The requested link does not exist'
      });
    }
    
    // Check if user is a participant
    const isParticipant = link.participants.some(p => 
      p.userId.toString() === user._id.toString()
    );
    
    if (!isParticipant) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have access to this link'
      });
    }
    
    if (link.status !== 'IN_PROGRESS') {
      return res.status(400).json({
        error: 'Invalid status',
        message: 'Meeting can only be completed when status is IN_PROGRESS'
      });
    }
    
    link.completeMeeting(duration || 0, notes || '');
    await link.save();
    
    // Generate AI summary if OpenAI is configured
    if (process.env.OPENAI_API_KEY) {
      try {
        const OpenAI = require('openai');
        const openai = new OpenAI({
          apiKey: process.env.OPENAI_API_KEY
        });
        await link.generateAISummary(openai);
        await link.save();
      } catch (aiError) {
        console.error('Error generating AI summary:', aiError);
      }
    }
    
    res.json({
      success: true,
      message: 'Meeting completed successfully',
      data: link
    });
  } catch (error) {
    console.error('Error completing meeting:', error);
    res.status(500).json({
      error: 'Failed to complete meeting',
      message: error.message
    });
  }
});

// POST /api/links/:linkId/outcomes - Add outcome
router.post('/:linkId/outcomes', async (req, res) => {
  try {
    const { linkId } = req.params;
    
    // req.user contains Google token payload, not our database user
    const googleUser = req.user;
    
    // Find user in our database
    const user = await User.findOne({ email: googleUser.email });
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User profile not found'
      });
    }
    
    // Validate request body
    const { error, value } = addOutcomeSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        message: error.details[0].message
      });
    }
    
    const { type, description, assignedTo, dueDate } = value;
    
    const link = await Link.findById(linkId);
    if (!link) {
      return res.status(404).json({
        error: 'Link not found',
        message: 'The requested link does not exist'
      });
    }
    
    // Check if user is a participant
    const isParticipant = link.participants.some(p => 
      p.userId.toString() === user._id.toString()
    );
    
    if (!isParticipant) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have access to this link'
      });
    }
    
    link.addOutcome(type, description, assignedTo, dueDate);
    await link.save();
    
    // Populate data for response
    await link.populate('outcomes.assignedTo', 'name email avatar');
    
    res.json({
      success: true,
      message: 'Outcome added successfully',
      data: link
    });
  } catch (error) {
    console.error('Error adding outcome:', error);
    res.status(500).json({
      error: 'Failed to add outcome',
      message: error.message
    });
  }
});

// GET /api/links/team/:teamId - Get team links
router.get('/team/:teamId', async (req, res) => {
  try {
    const { teamId } = req.params;
    const { status, limit = 20 } = req.query;
    
    const query = { team: teamId };
    if (status) query.status = status;
    
    const links = await Link.find(query)
      .populate('participants.userId', 'name email avatar department designation')
      .populate('outcomes.assignedTo', 'name email avatar')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));
    
    // After populating participants.userId, ensure every user has a 'name' field
    if (Array.isArray(links)) {
      links.forEach(link => {
        if (Array.isArray(link.participants)) {
          link.participants.forEach(p => {
            if (p.userId && !p.userId.name) {
              if (p.userId.email) {
                p.userId.name = p.userId.email.split('@')[0];
              } else {
                p.userId.name = 'Unknown';
              }
            }
          });
        }
      });
    } else if (links && Array.isArray(links.participants)) {
      links.participants.forEach(p => {
        if (p.userId && !p.userId.name) {
          if (p.userId.email) {
            p.userId.name = p.userId.email.split('@')[0];
          } else {
            p.userId.name = 'Unknown';
          }
        }
      });
    }
    
    // After populating participants.userId, add a debug log
    if (Array.isArray(links)) {
      links.forEach(link => {
        if (Array.isArray(link.participants)) {
          console.log('Populated participants for link', link._id, ':', link.participants.map(p => p.userId));
        }
      });
    } else if (links && Array.isArray(links.participants)) {
      console.log('Populated participants for link', links._id, ':', links.participants.map(p => p.userId));
    }
    
    res.json({
      success: true,
      data: links,
      count: links.length
    });
  } catch (error) {
    console.error('Error fetching team links:', error);
    res.status(500).json({
      error: 'Failed to fetch team links',
      message: error.message
    });
  }
});

// DELETE /api/links/:linkId - Delete a link
router.delete('/:linkId', async (req, res) => {
  try {
    const { linkId } = req.params;
    const deleted = await Link.findByIdAndDelete(linkId);
    if (!deleted) {
      return res.status(404).json({ error: 'Link not found' });
    }
    res.json({ success: true, message: 'Link deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete link', message: error.message });
  }
});

module.exports = router; 