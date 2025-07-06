const express = require('express');
const router = express.Router();
const Team = require('../models/Team');
const User = require('../models/User');
const Joi = require('joi');
const { verifyGoogleToken } = require('../middleware/auth');

// Validation schemas
const createTeamSchema = Joi.object({
  name: Joi.string().required().min(3).max(100),
  description: Joi.string().max(500),
  productName: Joi.string().required().min(2).max(100),
  productVersion: Joi.string().max(20),
  tags: Joi.array().items(Joi.string().max(50)),
  settings: Joi.object({
    visibility: Joi.string().valid('PUBLIC', 'PRIVATE', 'RESTRICTED'),
    allowMemberInvites: Joi.boolean(),
    requireApproval: Joi.boolean()
  })
});

const addMemberSchema = Joi.object({
  email: Joi.string().email().required(),
  name: Joi.string().required(),
  department: Joi.string().valid('PM', 'DEV', 'DESIGN', 'LEGAL', 'SECURITY', 'BIZ_OPS', 'CXO', 'STAKEHOLDER').required(),
  designation: Joi.string().allow('').optional(),
  role: Joi.string().optional() // for backward compatibility, but not required
});

// GET /api/teams - Get user's teams
router.get('/', verifyGoogleToken, async (req, res) => {
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
    
    // Get teams where user is a member
    const userWithTeams = await User.findById(user._id).populate({
      path: 'teams.teamId',
      populate: {
        path: 'members.userId',
        select: 'name email avatar role'
      }
    });
    
    const teams = userWithTeams.teams
      .filter(teamMembership => teamMembership.teamId)
      .map(teamMembership => ({
        ...teamMembership.teamId.toObject(),
        userRole: teamMembership.role,
        joinedAt: teamMembership.joinedAt
      }));
    
    res.json({
      success: true,
      data: teams,
      count: teams.length
    });
  } catch (error) {
    console.error('Error fetching teams:', error);
    res.status(500).json({
      error: 'Failed to fetch teams',
      message: error.message
    });
  }
});

// POST /api/teams - Create new team
router.post('/', verifyGoogleToken, async (req, res) => {
  try {
    // Validate request body
    const { error, value } = createTeamSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        message: error.details[0].message
      });
    }
    
    const { name, description, productName, productVersion, tags, settings } = value;
    
    // Find or create the owner user by Google email
    let ownerUser = await User.findOne({ email: req.user.email });
    if (!ownerUser) {
      ownerUser = await User.create({
        email: req.user.email,
        firstName: req.user.given_name || req.user.name?.split(' ')[0] || '',
        lastName: req.user.family_name || req.user.name?.split(' ')[1] || '',
        avatar: req.user.picture || null,
        onboarded: false,
        role: 'PM',
      });
    }
    const ownerId = ownerUser._id;
    
    // Check if team name already exists for this user
    const existingTeam = await Team.findOne({
      name,
      owner: ownerId
    });
    
    if (existingTeam) {
      return res.status(409).json({
        error: 'Team already exists',
        message: 'A team with this name already exists'
      });
    }
    
    // Create new team
    const team = new Team({
      name,
      description,
      productName,
      productVersion,
      owner: ownerId,
      tags,
      settings: {
        visibility: settings?.visibility || 'PRIVATE',
        allowMemberInvites: settings?.allowMemberInvites ?? true,
        requireApproval: settings?.requireApproval ?? false
      }
    });
    
    // Add owner as first member
    team.addMember(ownerId, 'OWNER');
    
    await team.save();
    
    // Update user's team associations
    await User.findByIdAndUpdate(ownerId, {
      $push: {
        teams: {
          teamId: team._id,
          role: 'OWNER',
          joinedAt: new Date()
        }
      }
    });
    
    // Populate team data for response
    await team.populate('members.userId', 'name email avatar role');
    
    res.status(201).json({
      success: true,
      message: 'Team created successfully',
      data: team
    });
  } catch (error) {
    console.error('Error creating team:', error);
    res.status(500).json({
      error: 'Failed to create team',
      message: error.message
    });
  }
});

// GET /api/teams/:teamId - Get team details
router.get('/:teamId', verifyGoogleToken, async (req, res) => {
  try {
    const { teamId } = req.params;
    
    const team = await Team.findById(teamId)
      .populate('owner', 'firstName lastName avatar')
      .populate('members.userId', 'name email avatar role stats badges');
    
    if (!team) {
      return res.status(404).json({
        error: 'Team not found',
        message: 'The requested team does not exist'
      });
    }
    
    res.json({
      success: true,
      data: team
    });
  } catch (error) {
    console.error('Error fetching team:', error);
    res.status(500).json({
      error: 'Failed to fetch team',
      message: error.message
    });
  }
});

// PUT /api/teams/:teamId - Update team
router.put('/:teamId', verifyGoogleToken, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { name, description, productName, productVersion, tags, settings, status } = req.body;
    
    const updateData = {};
    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (productName) updateData.productName = productName;
    if (productVersion) updateData.productVersion = productVersion;
    if (tags) updateData.tags = tags;
    if (settings) updateData.settings = settings;
    if (status) updateData.status = status;
    
    const team = await Team.findByIdAndUpdate(
      teamId,
      updateData,
      { new: true, runValidators: true }
    ).populate('members.userId', 'name email avatar role');
    
    if (!team) {
      return res.status(404).json({
        error: 'Team not found',
        message: 'The requested team does not exist'
      });
    }
    
    res.json({
      success: true,
      message: 'Team updated successfully',
      data: team
    });
  } catch (error) {
    console.error('Error updating team:', error);
    res.status(500).json({
      error: 'Failed to update team',
      message: error.message
    });
  }
});

// POST /api/teams/:teamId/members - Add member to team
router.post('/:teamId/members', verifyGoogleToken, async (req, res) => {
  try {
    const { teamId } = req.params;
    
    // Validate request body
    const { error, value } = addMemberSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        message: error.details[0].message
      });
    }
    
    const { email, name, department, designation } = value;
    
    // Find or create user by email
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({
        email,
        name,
        department,
        designation,
        avatar: null,
        onboarded: false
      });
    }
    
    // Check if user is already a member
    const team = await Team.findById(teamId);
    const existingMember = team.members.find(member => 
      member.userId.toString() === user._id.toString()
    );
    
    if (existingMember) {
      return res.status(409).json({
        error: 'User already a member',
        message: 'This user is already a member of the team'
      });
    }
    
    // Add user to team
    team.addMember(user._id, department); // use department as the team role
    await team.save();
    
    // Add team to user's team list
    await User.findByIdAndUpdate(user._id, {
      $push: {
        teams: {
          teamId: team._id,
          role: department, // use department as the role in the team
          joinedAt: new Date()
        }
      }
    });
    
    // Populate team data for response
    await team.populate('members.userId', 'name email avatar role');
    
    res.json({
      success: true,
      message: 'Member added successfully',
      data: {
        team,
        addedUser: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role
        }
      }
    });
  } catch (error) {
    console.error('Error adding member:', error);
    res.status(500).json({
      error: 'Failed to add member',
      message: error.message
    });
  }
});

// DELETE /api/teams/:teamId/members/:userId - Remove member from team
router.delete('/:teamId/members/:userId', verifyGoogleToken, async (req, res) => {
  try {
    const { teamId, userId } = req.params;
    
    // req.user contains Google token payload, not our database user
    const googleUser = req.user;
    
    // Find user in our database
    const currentUser = await User.findOne({ email: googleUser.email });
    if (!currentUser) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User profile not found'
      });
    }
    
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({
        error: 'Team not found',
        message: 'The requested team does not exist'
      });
    }
    
    // Check if user is trying to remove themselves (owner)
    if (userId === currentUser._id.toString()) {
      return res.status(400).json({
        error: 'Cannot remove owner',
        message: 'Team owner cannot remove themselves from the team'
      });
    }
    
    // Remove user from team
    team.removeMember(userId);
    await team.save();
    
    // Remove team from user's team list
    await User.findByIdAndUpdate(userId, {
      $pull: {
        teams: { teamId: team._id }
      }
    });
    
    res.json({
      success: true,
      message: 'Member removed successfully'
    });
  } catch (error) {
    console.error('Error removing member:', error);
    res.status(500).json({
      error: 'Failed to remove member',
      message: error.message
    });
  }
});

// GET /api/teams/:teamId/stats - Get team statistics
router.get('/:teamId/stats', async (req, res) => {
  try {
    const { teamId } = req.params;
    
    const team = await Team.findById(teamId)
      .populate('members.userId', 'name email avatar role stats badges');
    
    if (!team) {
      return res.status(404).json({
        error: 'Team not found',
        message: 'The requested team does not exist'
      });
    }
    
    // Calculate additional stats
    const memberStats = team.members.map(member => ({
      user: member.userId,
      role: member.role,
      joinedAt: member.joinedAt,
      isActive: member.isActive
    }));
    
    const response = {
      success: true,
      data: {
        team: {
          _id: team._id,
          name: team.name,
          productName: team.productName,
          stats: team.stats,
          reputationBadge: team.reputationBadge,
          memberCount: team.memberCount,
          lastActivity: team.lastActivity
        },
        members: memberStats,
        summary: {
          totalMembers: team.memberCount,
          activeMembers: team.stats.activeMembers,
          averageResponseTime: team.stats.averageResponseTime,
          responseRate: team.stats.responseRate,
          totalLinks: team.stats.totalLinks
        }
      }
    };
    
    res.json(response);
  } catch (error) {
    console.error('Error fetching team stats:', error);
    res.status(500).json({
      error: 'Failed to fetch team statistics',
      message: error.message
    });
  }
});

// GET /api/teams/:teamId/members - Get team members
router.get('/:teamId/members', async (req, res) => {
  try {
    const { teamId } = req.params;
    const team = await Team.findById(teamId).populate('members.userId', 'name email avatar role');
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    res.json({ success: true, members: team.members });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch team members', message: error.message });
  }
});

// DELETE /api/teams/:teamId - Delete a team
router.delete('/:teamId', verifyGoogleToken, async (req, res) => {
  try {
    const { teamId } = req.params;
    const team = await Team.findByIdAndDelete(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    res.json({ success: true, message: 'Team deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete team', message: error.message });
  }
});

module.exports = router; 