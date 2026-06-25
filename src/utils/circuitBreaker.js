const logger = require('./logger');

// Simple circuit breaker implementation
// States: CLOSED (normal) → OPEN (failing) → HALF_OPEN (testing recovery)
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.recoveryTimeout = options.recoveryTimeout || 60000; // 1 minute
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED'; // CLOSED = working normally
  }

  // Check if we should allow a call through
  canExecute() {
    if (this.state === 'CLOSED') return true;

    if (this.state === 'OPEN') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;

      // Recovery timeout passed — try one request (HALF_OPEN)
      if (timeSinceFailure >= this.recoveryTimeout) {
        this.state = 'HALF_OPEN';
        logger.info('Circuit breaker moving to HALF_OPEN — testing recovery');
        return true;
      }

      return false; // Still open — reject
    }

    if (this.state === 'HALF_OPEN') return true;

    return false;
  }

  // Call this when a request succeeds
  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  // Call this when a request fails
  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      logger.warn('Circuit breaker OPEN — too many failures', {
        failureCount: this.failureCount,
        threshold: this.failureThreshold,
      });
    }
  }

  getState() {
    return this.state;
  }
}

module.exports = CircuitBreaker;