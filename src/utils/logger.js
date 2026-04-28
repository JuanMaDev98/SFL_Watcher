import Logtail from '@logtail/js'

const logger = new Logtail(process.env.BETTERSTACK_TOKEN)

export default logger
