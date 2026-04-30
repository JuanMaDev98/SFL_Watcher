module.exports = {
  error: (message, context = {}) => logger.error(`[ERROR] ${message}`, context),
  warn: (message, context = {}) => logger.warn(`[WARN] ${message}`, context),
  info: (message, context = {}) => console.info(`[INFO] ${message}`, context),
  debug: (message, context = {}) => console.debug(`[DEBUG] ${message}`, context)
};
