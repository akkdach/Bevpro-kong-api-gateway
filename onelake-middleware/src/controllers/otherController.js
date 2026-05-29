const otherGraphQLService = require('../services/otherGraphQLService');
const { logToFile } = require('../utils/logger');

class OtherController {
    async getData(req, res) {
        try {
            logToFile(`[OtherController] Received data request.`);

            const limit = req.query.limit ? parseInt(req.query.limit) : null;
            const params = {
                ticketno: req.query.ticketno || ''
            };

            let data = await otherGraphQLService.getData(params);

            if (limit && limit > 0) {
                data = data.slice(0, limit);
            }

            res.json({
                success: true,
                count: data.length,
                data: data
            });
        } catch (error) {
            logToFile(`[OtherController] Error: ${error.message}`);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
}

module.exports = new OtherController();
