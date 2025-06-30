const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // Profile information
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  avatar: {
    type: String,
    default: null
  },
  
  // Role and permissions
  role: {
    type: String,
    enum: ['PM', 'DEV', 'DESIGN', 'LEGAL', 'SECURITY', 'BIZ_OPS', 'CXO', 'STAKEHOLDER'],
    required: true
  },
  
  // Team associations
  teams: [{
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team'
    },
    role: {
      type: String,
      enum: ['OWNER', 'MEMBER', 'VIEWER'],
      default: 'MEMBER'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Gamification stats
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
    reputationScore: {
      type: Number,
      default: 100
    }
  },
  
  // Reputation badges
  badges: [{
    type: {
      type: String,
      enum: ['SUPER_RESPONDER', 'POWER_CONNECTOR', 'LINK_HERO', 'TEAM_MAGNET', 'GHOST_MODE', 'SILENT_WITNESS'],
      required: true
    },
    earnedAt: {
      type: Date,
      default: Date.now
    },
    description: String
  }],
  
  // Settings
  settings: {
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      push: {
        type: Boolean,
        default: true
      },
      inApp: {
        type: Boolean,
        default: true
      }
    },
    timezone: {
      type: String,
      default: 'UTC'
    }
  },
  
  // Onboarding status
  onboarded: {
    type: Boolean,
    default: false
  },
  
  // Timestamps
  lastActive: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ 'stats.reputationScore': -1 });

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return this.name;
});

// Method to calculate reputation score
userSchema.methods.calculateReputationScore = function() {
  let score = 100;
  
  // Response rate impact
  score += (this.stats.responseRate - 50) * 0.5;
  
  // Response time impact (faster = better)
  if (this.stats.averageResponseTime > 0) {
    score += Math.max(0, 24 - this.stats.averageResponseTime) * 2;
  }
  
  // Link creation bonus
  score += this.stats.totalLinks * 5;
  
  this.stats.reputationScore = Math.max(0, Math.min(200, score));
  return this.stats.reputationScore;
};

// Pre-save middleware to update reputation
userSchema.pre('save', function(next) {
  if (this.isModified('stats')) {
    this.calculateReputationScore();
  }
  next();
});

module.exports = mongoose.model('User', userSchema); 