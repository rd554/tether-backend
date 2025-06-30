const loggerMiddleware = (req, res, next) => {
  const start = Date.now();
  const { method, url, ip } = req;
  
  // Log request start
  console.log(`📥 ${method} ${url} - ${ip} - ${new Date().toISOString()}`);
  
  // Add user info if available
  if (req.user) {
    console.log(`👤 User: ${req.user.fullName} (${req.user.role})`);
  }
  
  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - start;
    const status = res.statusCode;
    
    // Color code based on status
    let statusColor = '🟢'; // Success
    if (status >= 400 && status < 500) {
      statusColor = '🟡'; // Client error
    } else if (status >= 500) {
      statusColor = '🔴'; // Server error
    }
    
    console.log(`${statusColor} ${method} ${url} - ${status} - ${duration}ms`);
    
    // Log errors
    if (status >= 400) {
      console.error(`❌ Error ${status}: ${url}`);
      if (chunk) {
        try {
          const errorBody = JSON.parse(chunk.toString());
          console.error(`   Message: ${errorBody.message || errorBody.error || 'Unknown error'}`);
        } catch (e) {
          console.error(`   Body: ${chunk.toString()}`);
        }
      }
    }
    
    // Call original end method
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
};

module.exports = loggerMiddleware; 