const express = require('express');
const router = express.Router();
const Team = require('../models/Team');
const User = require('../models/User');
const Link = require('../models/Link');
const { requireRole } = require('../middleware/auth');

// GET /api/dashboard/overview - Get dashboard overview
router.get('/overview', async (req, res) => {
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
    
    // Get user's teams
    const userTeams = await User.findById(user._id).populate({
      path: 'teams.teamId',
      populate: {
        path: 'members.userId',
        select: 'firstName lastName avatar role stats'
      }
    });
    
    const teams = userTeams.teams.map(t => t.teamId).filter(Boolean);
    
    // Get recent activity
    const recentLinks = await Link.find({
      'participants.userId': user._id
    })
    .populate('participants.userId', 'firstName lastName avatar')
    .populate('team', 'name productName')
    .sort({ createdAt: -1 })
    .limit(10);
    
    // Calculate summary stats (based only on Link data)
    const summary = {
      totalTeams: teams.length,
      activeTeams: teams.filter(team => team.status === 'ACTIVE').length,
      totalLinks: user.stats.linksCreated,
      responseRate: user.stats.responseRate || 0,
      averageResponseTime: user.stats.averageResponseTime || 0,
      reputationScore: user.stats.reputationScore || 0
    };
    
    res.json({
      success: true,
      data: {
        summary,
        teams,
        recentLinks,
        user: {
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          avatar: user.avatar,
          badges: user.badges
        }
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard overview:', error);
    res.status(500).json({
      error: 'Failed to fetch dashboard overview',
      message: error.message
    });
  }
});

// GET /api/dashboard/team/:teamId - Get team dashboard
router.get('/team/:teamId', async (req, res) => {
  try {
    const { teamId } = req.params;
    
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
    
    // Verify team membership
    const teamMembership = user.teams.find(t => t.teamId.toString() === teamId);
    
    if (!teamMembership) {
      return res.status(403).json({
        error: 'Team access denied',
        message: 'You are not a member of this team'
      });
    }
    
    // Get team details
    const team = await Team.findById(teamId)
      .populate('members.userId', 'firstName lastName avatar role stats badges')
      .populate('owner', 'firstName lastName avatar');
    
    if (!team) {
      return res.status(404).json({
        error: 'Team not found',
        message: 'The requested team does not exist'
      });
    }
    
    // Get recent links
    const recentLinks = await Link.find({ team: teamId })
      .populate('participants.userId', 'firstName lastName avatar')
      .sort({ createdAt: -1 })
      .limit(10);
    
    // Get member performance
    const memberPerformance = team.members.map(member => ({
      user: member.userId,
      role: member.role,
      joinedAt: member.joinedAt,
      stats: member.userId.stats,
      badges: member.userId.badges,
      isActive: member.isActive
    }));
    
    // Calculate team metrics
    const teamMetrics = {
      totalMembers: team.memberCount,
      activeMembers: team.stats.activeMembers,
      totalLinks: team.stats.totalLinks,
      totalNudges: team.stats.totalNudges,
      averageResponseTime: team.stats.averageResponseTime,
      responseRate: team.stats.responseRate,
      reputationBadge: team.reputationBadge
    };
    
    res.json({
      success: true,
      data: {
        team,
        metrics: teamMetrics,
        recentLinks,
        memberPerformance,
        userRole: teamMembership.role
      }
    });
  } catch (error) {
    console.error('Error fetching team dashboard:', error);
    res.status(500).json({
      error: 'Failed to fetch team dashboard',
      message: error.message
    });
  }
});

// GET /api/dashboard/cxo - Get CXO-level dashboard (for CXO role)
router.get('/cxo', async (req, res) => {
  try {
    // Get all teams
    const teams = await Team.find({ status: 'ACTIVE' })
      .populate('owner', 'firstName lastName')
      .populate('members.userId', 'firstName lastName role stats')
      .sort({ lastActivity: -1 });
    
    // Get all users with stats
    const users = await User.find()
      .select('firstName lastName role stats badges teams')
      .sort({ 'stats.reputationScore': -1 });
    
    // Calculate organization-wide metrics
    const orgMetrics = {
      totalTeams: teams.length,
      totalUsers: users.length,
      activeTeams: teams.filter(t => t.status === 'ACTIVE').length,
      averageResponseRate: calculateAverageResponseRate(teams),
      averageResponseTime: calculateAverageResponseTime(teams),
      topPerformers: users.slice(0, 5),
      teamsNeedingAttention: teams.filter(t => t.stats.responseRate < 50).slice(0, 5)
    };
    
    // Get recent activity across all teams
    const recentActivity = await Link.find()
      .populate('participants.userId', 'firstName lastName')
      .populate('team', 'name productName')
      .sort({ createdAt: -1 })
      .limit(20);
    
    // Team performance summary
    const teamPerformance = teams.map(team => ({
      _id: team._id,
      name: team.name,
      productName: team.productName,
      memberCount: team.memberCount,
      stats: team.stats,
      reputationBadge: team.reputationBadge,
      lastActivity: team.lastActivity,
      owner: team.owner
    }));
    
    res.json({
      success: true,
      data: {
        orgMetrics,
        teams: teamPerformance,
        recentActivity,
        topPerformers: orgMetrics.topPerformers,
        teamsNeedingAttention: orgMetrics.teamsNeedingAttention
      }
    });
  } catch (error) {
    console.error('Error fetching CXO dashboard:', error);
    res.status(500).json({
      error: 'Failed to fetch CXO dashboard',
      message: error.message
    });
  }
});

// GET /api/dashboard/analytics - Get analytics data
router.get('/analytics', async (req, res) => {
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
    
    const { teamId, period = '30d' } = req.query;
    
    // Build date filter
    const dateFilter = getDateFilter(period);
    
    // Build query
    let query = {};
    if (teamId) {
      query.team = teamId;
    }
    query.createdAt = dateFilter;
    
    // Get links analytics
    const linksAnalytics = await Link.aggregate([
      { $match: query },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          },
          count: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Get team performance trends
    const teamTrends = await Team.aggregate([
      { $match: { status: 'ACTIVE' } },
      {
        $group: {
          _id: null,
          avgResponseRate: { $avg: "$stats.responseRate" },
          avgResponseTime: { $avg: "$stats.averageResponseTime" },
          totalLinks: { $sum: "$stats.totalLinks" },
          totalNudges: { $sum: "$stats.totalNudges" }
        }
      }
    ]);
    
    res.json({
      success: true,
      data: {
        links: linksAnalytics,
        teamTrends: teamTrends[0] || {},
        period
      }
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      error: 'Failed to fetch analytics',
      message: error.message
    });
  }
});

// Helper functions
function calculateAverageResponseRate(teams) {
  if (teams.length === 0) return 0;
  const totalRate = teams.reduce((sum, team) => sum + team.stats.responseRate, 0);
  return Math.round(totalRate / teams.length);
}

function calculateAverageResponseTime(teams) {
  if (teams.length === 0) return 0;
  const totalTime = teams.reduce((sum, team) => sum + team.stats.averageResponseTime, 0);
  return Math.round(totalTime / teams.length);
}

function getDateFilter(period) {
  const now = new Date();
  let startDate;
  
  switch (period) {
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '90d':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  
  return { $gte: startDate };
}

module.exports = router; 