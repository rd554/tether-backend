const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Team = require('../models/Team');
const Joi = require('joi');

// Validation schemas
const updateProfileSchema = Joi.object({
  firstName: Joi.string().min(2).max(50),
  lastName: Joi.string().min(2).max(50),
  role: Joi.string().valid('PM', 'DEV', 'DESIGN', 'LEGAL', 'SECURITY', 'BIZ_OPS', 'CXO', 'STAKEHOLDER'),
  settings: Joi.object({
    notifications: Joi.object({
      email: Joi.boolean(),
      push: Joi.boolean(),
      inApp: Joi.boolean()
    }),
    timezone: Joi.string()
  })
});

// GET /api/users/profile - Get current user profile
router.get('/profile', async (req, res) => {
  try {
    // req.user contains Google token payload, not our database user
    const googleUser = req.user;
    
    // Find user in our database
    const user = await User.findOne({ email: googleUser.email })
      .populate({
        path: 'teams.teamId',
        select: 'name productName stats reputationBadge'
      });
    
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User profile not found'
      });
    }
    
    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({
      error: 'Failed to fetch user profile',
      message: error.message
    });
  }
});

// PUT /api/users/profile - Update current user profile
router.put('/profile', async (req, res) => {
  try {
    // req.user contains Google token payload, not our database user
    const googleUser = req.user;
    
    // Validate request body
    const { error, value } = updateProfileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        message: error.details[0].message
      });
    }
    
    // Find user in our database
    const user = await User.findOneAndUpdate(
      { email: googleUser.email },
      value,
      { new: true, runValidators: true }
    ).populate({
      path: 'teams.teamId',
      select: 'name productName stats reputationBadge'
    });
    
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User profile not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: user
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({
      error: 'Failed to update user profile',
      message: error.message
    });
  }
});

// GET /api/users/stats - Get current user stats
router.get('/stats', async (req, res) => {
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
    
    // Calculate additional stats
    const stats = {
      ...user.stats,
      reputationLevel: getReputationLevel(user.stats.reputationScore),
      recentActivity: await getRecentActivity(user._id),
      teamPerformance: await getTeamPerformance(user._id)
    };
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({
      error: 'Failed to fetch user stats',
      message: error.message
    });
  }
});

// GET /api/users/leaderboard - Get leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const { teamId, limit = 10 } = req.query;
    
    let query = {};
    if (teamId) {
      // Get users in specific team
      const team = await Team.findById(teamId);
      if (!team) {
        return res.status(404).json({
          error: 'Team not found',
          message: 'The specified team does not exist'
        });
      }
      
      const memberIds = team.members.map(member => member.userId);
      query._id = { $in: memberIds };
    }
    
    const users = await User.find(query)
      .select('firstName lastName avatar role stats badges')
      .sort({ 'stats.reputationScore': -1 })
      .limit(parseInt(limit));
    
    const leaderboard = users.map((user, index) => ({
      rank: index + 1,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
        role: user.role
      },
      stats: user.stats,
      badges: user.badges,
      reputationLevel: getReputationLevel(user.stats.reputationScore)
    }));
    
    res.json({
      success: true,
      data: leaderboard
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({
      error: 'Failed to fetch leaderboard',
      message: error.message
    });
  }
});

// GET /api/users/search - Search users
router.get('/search', async (req, res) => {
  try {
    const { q, role, teamId, limit = 20 } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(400).json({
        error: 'Search query required',
        message: 'Please provide a search query with at least 2 characters'
      });
    }
    
    let query = {
      $or: [
        { firstName: { $regex: q, $options: 'i' } },
        { lastName: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ]
    };
    
    if (role) {
      query.role = role;
    }
    
    if (teamId) {
      // Get users in specific team
      const team = await Team.findById(teamId);
      if (team) {
        const memberIds = team.members.map(member => member.userId);
        query._id = { $in: memberIds };
      }
    }
    
    const users = await User.find(query)
      .select('firstName lastName email avatar role')
      .limit(parseInt(limit));
    
    res.json({
      success: true,
      data: users,
      count: users.length
    });
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({
      error: 'Failed to search users',
      message: error.message
    });
  }
});

// GET /api/users/me - Get current user info (for onboarding check)
router.get('/me', async (req, res) => {
  try {
    // req.user contains Google token payload, not our database user
    const googleUser = req.user;
    
    // Find or create user in our database
    let user = await User.findOne({ email: googleUser.email });
    if (!user) {
      user = await User.create({
        email: googleUser.email,
        firstName: googleUser.given_name || googleUser.name?.split(' ')[0] || '',
        lastName: googleUser.family_name || googleUser.name?.split(' ').slice(1).join(' ') || '',
        avatar: googleUser.picture || null,
        role: 'PM',
        onboarded: false,
        stats: {
          reputationScore: 0,
          linksCreated: 0,
          responsesReceived: 0,
          averageResponseTime: 0
        }
      });
    }
    
    res.json({ 
      success: true, 
      data: { 
        _id: user._id, 
        email: user.email, 
        onboarded: user.onboarded, 
        firstName: user.firstName, 
        lastName: user.lastName 
      } 
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ 
      error: 'Failed to fetch user', 
      message: error.message 
    });
  }
});

// PUT /api/users/onboarded - Mark user as onboarded
router.put('/onboarded', async (req, res) => {
  try {
    // req.user contains Google token payload, not our database user
    const googleUser = req.user;
    
    // Find or create user in our database
    let user = await User.findOne({ email: googleUser.email });
    if (!user) {
      user = await User.create({
        email: googleUser.email,
        firstName: googleUser.given_name || googleUser.name?.split(' ')[0] || '',
        lastName: googleUser.family_name || googleUser.name?.split(' ').slice(1).join(' ') || '',
        avatar: googleUser.picture || null,
        role: 'PM',
        onboarded: false,
        stats: {
          reputationScore: 0,
          linksCreated: 0,
          responsesReceived: 0,
          averageResponseTime: 0
        }
      });
    }
    
    // Update the user's onboarded status
    user = await User.findByIdAndUpdate(user._id, { onboarded: true }, { new: true });
    
    res.json({ 
      success: true, 
      message: 'User marked as onboarded', 
      data: { 
        _id: user._id,
        email: user.email,
        onboarded: user.onboarded,
        firstName: user.firstName,
        lastName: user.lastName
      } 
    });
  } catch (error) {
    console.error('Error updating onboarding status:', error);
    res.status(500).json({ 
      error: 'Failed to update onboarding status', 
      message: error.message 
    });
  }
});

// GET /api/users/:userId - Get user by ID (limited info)
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId)
      .select('firstName lastName avatar role stats badges')
      .populate({
        path: 'teams.teamId',
        select: 'name productName'
      });
    
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'The requested user does not exist'
      });
    }
    
    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      error: 'Failed to fetch user',
      message: error.message
    });
  }
});

// Helper functions
function getReputationLevel(score) {
  if (score >= 180) return { level: 'LEGENDARY', color: 'purple', emoji: '👑' };
  if (score >= 150) return { level: 'EXCELLENT', color: 'gold', emoji: '⭐' };
  if (score >= 120) return { level: 'GOOD', color: 'green', emoji: '✅' };
  if (score >= 90) return { level: 'AVERAGE', color: 'blue', emoji: '📊' };
  if (score >= 60) return { level: 'NEEDS_IMPROVEMENT', color: 'orange', emoji: '⚠️' };
  return { level: 'POOR', color: 'red', emoji: '🔴' };
}

async function getRecentActivity(userId) {
  // This would typically query recent links, nudges, etc.
  // For now, return a placeholder
  return {
    lastLink: null,
    activeTeams: 0
  };
}

async function getTeamPerformance(userId) {
  const user = await User.findById(userId).populate('teams.teamId');
  const teamStats = user.teams.map(teamMembership => ({
    team: teamMembership.teamId,
    role: teamMembership.role,
    joinedAt: teamMembership.joinedAt
  }));
  
  return teamStats;
}

module.exports = router; 