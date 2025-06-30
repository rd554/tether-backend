const mongoose = require('mongoose');

const linkSchema = new mongoose.Schema({
  // Basic link information
  title: {
    type: String,
    required: true,
    trim: true
  },
  
  purpose: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  
  // Team context
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true
  },
  
  // Participants
  participants: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['INITIATOR', 'PARTICIPANT', 'OBSERVER'],
      default: 'PARTICIPANT'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Status tracking
  status: {
    type: String,
    enum: ['PENDING', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
    default: 'PENDING'
  },
  
  // Timing
  scheduledAt: {
    type: Date,
    default: null
  },
  startedAt: {
    type: Date,
    default: null
  },
  completedAt: {
    type: Date,
    default: null
  },
  duration: {
    type: Number, // in minutes
    default: 0
  },
  
  // Meeting details
  meetingType: {
    type: String,
    enum: ['QUICK_SYNC', 'REVIEW', 'PLANNING', 'DECISION', 'BRAINSTORM', 'STATUS_UPDATE'],
    required: true
  },
  
  // Outcomes and decisions
  outcomes: [{
    type: {
      type: String,
      enum: ['DECISION', 'ACTION_ITEM', 'BLOCKER', 'INSIGHT', 'NEXT_STEPS'],
      required: true
    },
    description: {
      type: String,
      required: true,
      trim: true
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    dueDate: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'],
      default: 'PENDING'
    }
  }],
  
  // AI-generated summary
  aiSummary: {
    content: {
      type: String,
      trim: true,
      default: ''
    },
    generatedAt: {
      type: Date,
      default: null
    },
    model: {
      type: String,
      default: 'gpt-3.5-turbo'
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0
    }
  },
  
  // Manual notes
  notes: {
    type: String,
    trim: true,
    default: ''
  },
  
  // Tags and categorization
  tags: [{
    type: String,
    trim: true
  }],
  
  // Priority and impact
  priority: {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    default: 'MEDIUM'
  },
  
  impact: {
    type: String,
    enum: ['MINOR', 'MODERATE', 'MAJOR', 'BLOCKING'],
    default: 'MODERATE'
  },
  
  // Follow-up tracking
  followUp: {
    required: {
      type: Boolean,
      default: false
    },
    scheduledAt: {
      type: Date,
      default: null
    },
    parentLinkId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Link',
      default: null
    }
  },
  
  // Metrics
  metrics: {
    participantCount: {
      type: Number,
      default: 0
    },
    outcomeCount: {
      type: Number,
      default: 0
    },
    completionRate: {
      type: Number, // percentage
      default: 0
    }
  },
  
  // Metadata
  metadata: {
    createdVia: {
      type: String,
      enum: ['NUDGE', 'MANUAL', 'SCHEDULED'],
      default: 'MANUAL'
    },
    location: {
      type: String,
      default: ''
    },
    meetingUrl: {
      type: String,
      default: ''
    },
    attachments: [{
      name: String,
      url: String,
      type: String
    }]
  }
}, {
  timestamps: true
});

// Indexes for performance
linkSchema.index({ team: 1 });
linkSchema.index({ 'participants.userId': 1 });
linkSchema.index({ status: 1 });
linkSchema.index({ scheduledAt: 1 });
linkSchema.index({ createdAt: -1 });

// Virtual for participant count
linkSchema.virtual('participantCount').get(function() {
  return this.participants.length;
});

// Virtual for completion status
linkSchema.virtual('isCompleted').get(function() {
  return this.status === 'COMPLETED';
});

// Method to add participant
linkSchema.methods.addParticipant = function(userId, role = 'PARTICIPANT') {
  const existingParticipant = this.participants.find(p => 
    p.userId.toString() === userId.toString()
  );
  
  if (!existingParticipant) {
    this.participants.push({
      userId,
      role,
      joinedAt: new Date()
    });
    this.metrics.participantCount = this.participants.length;
  }
};

// Method to start meeting
linkSchema.methods.startMeeting = function() {
  this.status = 'IN_PROGRESS';
  this.startedAt = new Date();
};

// Method to complete meeting
linkSchema.methods.completeMeeting = function(duration, notes = '') {
  this.status = 'COMPLETED';
  this.completedAt = new Date();
  this.duration = duration;
  this.notes = notes;
  
  // Calculate completion rate based on outcomes
  if (this.outcomes.length > 0) {
    const completedOutcomes = this.outcomes.filter(o => o.status === 'COMPLETED').length;
    this.metrics.completionRate = (completedOutcomes / this.outcomes.length) * 100;
  }
  
  this.metrics.outcomeCount = this.outcomes.length;
};

// Method to add outcome
linkSchema.methods.addOutcome = function(type, description, assignedTo = null, dueDate = null) {
  this.outcomes.push({
    type,
    description,
    assignedTo,
    dueDate,
    status: 'PENDING'
  });
  this.metrics.outcomeCount = this.outcomes.length;
};

// Method to generate AI summary
linkSchema.methods.generateAISummary = async function(openai) {
  try {
    const prompt = `Summarize this meeting in one concise sentence:
    
    Purpose: ${this.purpose}
    Type: ${this.meetingType}
    Outcomes: ${this.outcomes.map(o => o.description).join(', ')}
    Notes: ${this.notes}
    
    Summary:`;
    
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
      temperature: 0.7
    });
    
    this.aiSummary = {
      content: response.choices[0].message.content.trim(),
      generatedAt: new Date(),
      model: 'gpt-3.5-turbo',
      confidence: 0.8
    };
    
    return this.aiSummary;
  } catch (error) {
    console.error('Error generating AI summary:', error);
    return null;
  }
};

// Pre-save middleware to update metrics
linkSchema.pre('save', function(next) {
  if (this.isModified('participants')) {
    this.metrics.participantCount = this.participants.length;
  }
  
  if (this.isModified('outcomes')) {
    this.metrics.outcomeCount = this.outcomes.length;
    
    if (this.outcomes.length > 0) {
      const completedOutcomes = this.outcomes.filter(o => o.status === 'COMPLETED').length;
      this.metrics.completionRate = (completedOutcomes / this.outcomes.length) * 100;
    }
  }
  
  next();
});

// Static method to find upcoming links
linkSchema.statics.findUpcoming = function(userId, limit = 10) {
  return this.find({
    'participants.userId': userId,
    status: { $in: ['PENDING', 'SCHEDULED'] },
    scheduledAt: { $gte: new Date() }
  })
  .sort({ scheduledAt: 1 })
  .limit(limit)
  .populate('participants.userId', 'firstName lastName avatar')
  .populate('team', 'name productName');
};

// Static method to find recent links
linkSchema.statics.findRecent = function(teamId, limit = 20) {
  return this.find({
    team: teamId,
    status: { $in: ['COMPLETED', 'IN_PROGRESS'] }
  })
  .sort({ createdAt: -1 })
  .limit(limit)
  .populate('participants.userId', 'firstName lastName avatar')
  .populate('outcomes.assignedTo', 'firstName lastName');
};

module.exports = mongoose.model('Link', linkSchema); 