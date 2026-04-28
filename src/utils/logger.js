module.exports = {
  error: (message, context = {}) => console.error(`[ERROR] ${message}`, context),
  warn: (message, context = {}) => console.warn(`[WARN] ${message}`, context),
  info: (message, context = {}) => console.info(`[INFO] ${message}`, context),
  debug: (message, context = {}) => console.debug(`[DEBUG] ${message}`, context)
};
