const { Logtail } = require('@logtail/js');

const logger = new Logtail(process.env.BETTERSTACK_TOKEN);

module.exports = logger;
