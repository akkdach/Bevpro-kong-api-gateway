const graphqlService = require('../services/graphqlService');
const { logToFile } = require('../utils/logger');

class FSRProtalController {
    async getOrders(req, res) {
        try {
            const { view, page = 0, limit } = req.query;
            const viewName = view || 'Service_BN15_Refurbish';

            // Whitelist of allowed views
            const ALLOWED_VIEWS = [
                'Service_BN04_Install',
                'Service_BN09_Remove',
                'Service_BN15_Refurbish',
                'Service_BN15_Refurbish_NB2CLOAN',
                'Service_BN09_Remove_NB2CLOAN', // New View
                'Service_Summary_All',
                'Performance_Matrix', // New Matrix View
                'ServiceOrder_QRCode',
                // FSRProtal_API views
                'service_BN04_NB2CLOAN_New',
                'Service_BN04_New',
                'service_BN15_New',
                'service_BN09_NB2CLOAN_New',
                'Service_BN09_New',
                'service_BN15_NB2CLOAN_New',
                // B2B views
                'Service_BN04_New_B2B',
                'Service_BN09_New_B2B',
                'Service_BN15_New_B2B',
                // BN02 views
                'Service_BN02_New',
                'Service_BN02_New_B2B',
                // BN01 views
                'Service_BN01_New_B2B',
                // Dispatch Required Fields
                'Service_RequiField_Dispatch',
                // New B2B view
                'Service_New_B2B',
                // New NB2C view
                'Service_New_NB2C'
            ];

            if (!ALLOWED_VIEWS.includes(viewName)) {
                return res.status(400).json({ error: 'Invalid view name' });
            }

            logToFile(`[FSRProtal-GraphQL] API Request: /api/fsr-protal/orders?view=${viewName}&page=${page}&limit=${limit || 'all'}`);

            let allData = [];
            const RELATED_VIEWS = ['Service_BN04_Install', 'Service_BN09_Remove', 'Service_BN15_Refurbish', 'Service_BN15_Refurbish_NB2CLOAN', 'Service_BN09_Remove_NB2CLOAN', 'Service_Summary_All'];

            // If the view is one of our related set, ALWAYS use BN09 as the Master/Base
            if (RELATED_VIEWS.includes(viewName)) {
                logToFile(`[FSRProtal-GraphQL] Using Master View Strategy (Base: Service_BN09_Remove) for requested view: ${viewName}`);

                // 1. Fetch ALL 5 views concurrently
                const [bn09Data, bn04Data, bn15Data, bn15LoanData, bn09LoanData, linesData] = await Promise.all([
                    graphqlService.queryView('Service_BN09_Remove'), // Master Base
                    graphqlService.queryView('Service_BN04_Install'),
                    graphqlService.queryView('Service_BN15_Refurbish'),
                    graphqlService.queryView('Service_BN15_Refurbish_NB2CLOAN'),
                    graphqlService.queryView('Service_BN09_Remove_NB2CLOAN'),
                    graphqlService.queryView('smaserviceorderline') // Fetch Lines
                ]);

                // 2. Index auxiliary views by bpc_ticketno
                const installMap = new Map();
                bn04Data.forEach(item => {
                    if (item.bpc_ticketno) installMap.set(item.bpc_ticketno, item);
                });

                const refurbishMap = new Map();
                bn15Data.forEach(item => {
                    if (item.bpc_ticketno) refurbishMap.set(item.bpc_ticketno, item);
                });

                const refurbLoanMap = new Map();
                bn15LoanData.forEach(item => {
                    if (item.bpc_ticketno) refurbLoanMap.set(item.bpc_ticketno, item);
                });

                const remLoanMap = new Map();
                bn09LoanData.forEach(item => {
                    if (item.bpc_ticketno) remLoanMap.set(item.bpc_ticketno, item);
                });

                // Index Lines by serviceorderid (One-to-Many)
                const linesMap = new Map();
                linesData.forEach(line => {
                    if (line.serviceorderid) {
                        if (!linesMap.has(line.serviceorderid)) {
                            linesMap.set(line.serviceorderid, []);
                        }
                        linesMap.get(line.serviceorderid).push(line);
                    }
                });

                logToFile(`[FSRProtal-GraphQL] Join Prep: Indexed ${installMap.size} installs, ${refurbishMap.size} refurbs, ${refurbLoanMap.size} refloans, ${remLoanMap.size} remloans, ${linesData.length} lines.`);

                // 3. Perform Left Join on BN09 (Master)
                allData = bn09Data.map(masterRow => {
                    const ticket = masterRow.bpc_ticketno;
                    const joinInstall = ticket ? installMap.get(ticket) : null;
                    const joinRefurb = ticket ? refurbishMap.get(ticket) : null;
                    const joinRefurbLoan = ticket ? refurbLoanMap.get(ticket) : null;
                    const joinRemLoan = ticket ? remLoanMap.get(ticket) : null;

                    // Determine the "Main" object to display based on the requested view
                    let mainObject = {};

                    if (viewName === 'Service_BN04_Install') {
                        mainObject = joinInstall || {};
                    } else if (viewName === 'Service_BN15_Refurbish') {
                        mainObject = joinRefurb || {};
                    } else if (viewName === 'Service_BN15_Refurbish_NB2CLOAN') {
                        mainObject = joinRefurbLoan || {};
                    } else if (viewName === 'Service_BN09_Remove_NB2CLOAN') {
                        mainObject = joinRemLoan || {};
                    } else {
                        // BN09 and Summary both use Master row as base
                        mainObject = masterRow;
                    }

                    // Attach Lines - Find matching lines for the current main object's serviceorderid
                    // Note: masterRow.serviceorderid might be different from mainObject.serviceorderid if mainObject is from a joined table?
                    // Usually they share ticketno, but let's check the serviceorderid of the *displayed* object first.
                    const currentServiceOrderId = mainObject.serviceorderid || masterRow.serviceorderid;
                    const relatedLines = currentServiceOrderId ? (linesMap.get(currentServiceOrderId) || []) : [];

                    return {
                        ...mainObject, // The valid fields for the current view

                        // Always ensure TicketNo is present (from Master)
                        bpc_ticketno: masterRow.bpc_ticketno,

                        // User Request: Customer number
                        custaccount: masterRow.custaccount,

                        // Add Cross-Reference Info & Types
                        master_serviceorderid: masterRow.serviceorderid,

                        // Install Info
                        install_serviceorderid: joinInstall?.serviceorderid || null,
                        install_type: joinInstall?.bpc_serviceordertypecode || null, // Added Type
                        install_status: joinInstall?.bpc_serviceobjectgroup || null,
                        install_scheduledstart: joinInstall?.bpc_scheduledstart || null, // Explicitly exposed for separation

                        // Refurb Info
                        refurb_serviceorderid: joinRefurb?.serviceorderid || null,
                        refurb_type: joinRefurb?.bpc_serviceordertypecode || null, // Added Type
                        refurb_status: joinRefurb?.bpc_serviceobjectgroup || null,
                        refurb_scheduledstart: joinRefurb?.bpc_scheduledstart || null, // Explicitly exposed for calculation

                        // Refurb Loan Info
                        refurb_loan_serviceorderid: joinRefurbLoan?.serviceorderid || null,
                        refurb_loan_type: joinRefurbLoan?.bpc_serviceordertypecode || null,
                        refurb_loan_status: joinRefurbLoan?.bpc_serviceobjectgroup || null,

                        // Remove Loan Info
                        rem_loan_scheduledstart: joinRemLoan?.bpc_scheduledstart || null,

                        // Lines
                        lines: relatedLines,

                        // Special Overrides for Summary View
                        bpc_mobilestatus: (viewName === 'Service_Summary_All')
                            ? (joinRefurbLoan?.bpc_mobilestatus || null)
                            : (mainObject.bpc_mobilestatus || null),

                        bpc_actualstartdate: (viewName === 'Service_Summary_All')
                            ? (joinInstall?.bpc_actualstartdate || null)
                            : (mainObject.bpc_actualstartdate || null)
                    };
                });

                logToFile(`[FSRProtal-GraphQL] Join Complete. Master Records: ${allData.length}`);

            } else {
                // Fallback for other unrelated views (if any)
                allData = await graphqlService.queryView(viewName);
            }

            logToFile(`[FSRProtal-GraphQL] Retrieved ${allData.length} records from GraphQL: ${viewName}`);

            // Pagination (only if limit is specified)
            const total = allData.length;
            let responseData = allData;

            if (limit) {
                const startIndex = page * limit;
                const endIndex = startIndex + parseInt(limit);
                responseData = allData.slice(startIndex, endIndex);
            }

            logToFile(`[FSRProtal-GraphQL] Response: Returning ${responseData.length} records (from total ${total})`);
            if (responseData.length > 0) {
                console.log("DEBUG: First Record Sample:", JSON.stringify(responseData[0], null, 2));
            }

            res.json({
                data: responseData,
                total: total,
                page: parseInt(page),
                limit: limit ? parseInt(limit) : total
            });

        } catch (error) {
            logToFile(`[FSRProtal-GraphQL] Error: ${error.message}`);
            res.status(500).json({
                error: 'Failed to fetch orders from GraphQL',
                details: error.message
            });
        }
    }

    /**
     * Service Header + Line data source backed by Stored Procedure.
     * Calling Service_Header_Line_Proc
     * GET /api/fsr-protal/service-header?ticketno=T0001234
     */
    async getServiceHeader(req, res) {
        try {
            const ticketno = req.query.ticketno || '';

            logToFile(`[FSRProtal-GraphQL] API Request: /api/fsr-protal/service-header?ticketno=${ticketno}`);

            const allData = await graphqlService.executeServiceHeaderLineProc(ticketno);

            logToFile(`[FSRProtal-GraphQL] Service Header Line Response: Returning ${allData.length} records`);

            res.json({
                success: true,
                data: allData,
                total: allData.length
            });
        } catch (error) {
            logToFile(`[FSRProtal-GraphQL] Service Header Line Error: ${error.message}`);
            res.status(500).json({
                error: 'Failed to fetch service header + line from GraphQL',
                details: error.message
            });
        }
    }

    /**
     * Request Status data source backed by Stored Procedure.
     * Calling REFERENCEDPONUMBER
     * GET /api/request-status/:referencedPoNumber (Basic Auth)
     */
    async getRequestStatus(req, res) {
        try {
            const referencedPoNumber = req.params.referencedPoNumber || '';

            logToFile(`[FSRProtal-GraphQL] API Request: /api/request-status/${referencedPoNumber}`);

            const allData = await graphqlService.executeReferencedPoNumber(referencedPoNumber);

            logToFile(`[FSRProtal-GraphQL] Request Status Response: Returning ${allData.length} records`);

            // Return first row as flat object with STATUS and MESSAGE
            const row = allData.length > 0 ? allData[0] : {};

            res.json({
                Serviceorderid: row.Serviceorderid || '',
                ServiceStage: row.ServiceStage || '',
                PostponeDate: row.PostponeDate || '',
                UnkhowpostponeDate: row.UnkhowpostponeDate || '',
                PostponereasonDesc: row.PostponereasonDesc || '',
                Scheduledstart: row.Scheduledstart || '',
                Modelnodescription: row.Modelnodescription || '',
                STATUS: allData.length > 0 ? 'SUCCESS' : 'NOT_FOUND',
                MESSAGE: allData.length > 0 ? 'Data retrieved successfully' : 'No data found for the given reference PO number'
            });
        } catch (error) {
            logToFile(`[FSRProtal-GraphQL] Request Status Error: ${error.message}`);
            res.status(500).json({
                Serviceorderid: '',
                ServiceStage: '',
                PostponeDate: '',
                UnkhowpostponeDate: '',
                PostponereasonDesc: '',
                Scheduledstart: '',
                Modelnodescription: '',
                STATUS: 'ERROR',
                MESSAGE: error.message
            });
        }
    }
}

module.exports = new FSRProtalController();
