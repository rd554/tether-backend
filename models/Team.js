const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  // Basic team information
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  
  // Product association
  productName: {
    type: String,
    required: true,
    trim: true
  },
  productVersion: {
    type: String,
    default: 'v1.0'
  },
  
  // Team ownership
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Team members with roles
  members: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['OWNER', 'PM', 'DEV', 'DESIGN', 'LEGAL', 'SECURITY', 'BIZ_OPS', 'STAKEHOLDER'],
      required: true
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    isActive: {
      type: Boolean,
      default: true
    }
  }],
  
  // Team settings
  settings: {
    visibility: {
      type: String,
      enum: ['PUBLIC', 'PRIVATE', 'RESTRICTED'],
      default: 'PRIVATE'
    },
    allowMemberInvites: {
      type: Boolean,
      default: true
    },
    requireApproval: {
      type: Boolean,
      default: false
    }
  },
  
  // Team stats for gamification
  stats: {
    totalLinks: {
      type: Number,
      default: 0
    },
    averageResponseTime: {
      type: Number, // in hours
      default: 0
    },
    responseRate: {
      type: Number, // percentage
      default: 0
    },
    activeMembers: {
      type: Number,
      default: 0
    }
  },
  
  // Team reputation badge
  reputationBadge: {
    type: {
      type: String,
      enum: ['SUPER_RESPONDERS', 'SLOW_STEADY', 'GHOST_MODE', 'CLEAR_COMMUNICATORS'],
      default: null
    },
    updatedAt: {
      type: Date,
      default: Date.now
    },
    description: String
  },
  
  // Team status
  status: {
    type: String,
    enum: ['ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'],
    default: 'ACTIVE'
  },
  
  // Tags for categorization
  tags: [{
    type: String,
    trim: true
  }],
  
  // Timestamps
  lastActivity: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for performance
teamSchema.index({ owner: 1 });
teamSchema.index({ 'members.userId': 1 });
teamSchema.index({ status: 1 });
teamSchema.index({ productName: 1 });

// Virtual for member count
teamSchema.virtual('memberCount').get(function() {
  return this.members.filter(member => member.isActive).length;
});

// Method to add member
teamSchema.methods.addMember = function(userId, role) {
  const existingMember = this.members.find(member => 
    member.userId.toString() === userId.toString()
  );
  
  if (existingMember) {
    existingMember.role = role;
    existingMember.isActive = true;
  } else {
    this.members.push({
      userId,
      role,
      joinedAt: new Date(),
      isActive: true
    });
  }
  
  this.stats.activeMembers = this.members.filter(member => member.isActive).length;
};

// Method to remove member
teamSchema.methods.removeMember = function(userId) {
  const memberIndex = this.members.findIndex(member => 
    member.userId.toString() === userId.toString()
  );
  
  if (memberIndex !== -1) {
    this.members[memberIndex].isActive = false;
    this.stats.activeMembers = this.members.filter(member => member.isActive).length;
  }
};

// Method to update team stats
teamSchema.methods.updateStats = function(linkCount = 0, responseTime = 0, responseRate = 0) {
  this.stats.totalLinks += linkCount;
  
  if (responseTime > 0) {
    const currentAvg = this.stats.averageResponseTime;
    const totalResponses = this.stats.responseRate / 100;
    this.stats.averageResponseTime = ((currentAvg * totalResponses) + responseTime) / (totalResponses + 1);
  }
  
  if (responseRate > 0) {
    this.stats.responseRate = responseRate;
  }
  
  this.lastActivity = new Date();
};

// Method to calculate team reputation badge
teamSchema.methods.calculateReputationBadge = function() {
  let badge = null;
  let description = '';
  
  if (this.stats.responseRate >= 90 && this.stats.averageResponseTime <= 2) {
    badge = 'SUPER_RESPONDERS';
    description = 'Team responds quickly and consistently';
  } else if (this.stats.responseRate >= 70 && this.stats.averageResponseTime <= 24) {
    badge = 'CLEAR_COMMUNICATORS';
    description = 'Team maintains good communication flow';
  } else if (this.stats.responseRate >= 50) {
    badge = 'SLOW_STEADY';
    description = 'Team responds but could be faster';
  } else {
    badge = 'GHOST_MODE';
    description = 'Team needs to improve responsiveness';
  }
  
  this.reputationBadge = {
    type: badge,
    updatedAt: new Date(),
    description
  };
  
  return this.reputationBadge;
};

// Pre-save middleware to update reputation
teamSchema.pre('save', function(next) {
  if (this.isModified('stats')) {
    this.calculateReputationBadge();
  }
  next();
});

module.exports = mongoose.model('Team', teamSchema); 