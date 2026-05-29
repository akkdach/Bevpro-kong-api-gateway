const config = require('../config');
const { logToFile } = require('../utils/logger');
const service = require('../services/oneLakeService');
const sqlService = require('../services/sqlService');
const graphqlService = require('../services/graphqlService');

class ProIoTController {
    async getOrders(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;

            logToFile(`[ProIoT] API Request: /api/orders?page=${page}&limit=${limit}&view=${req.query.view || 'Default'}`);

            let allData = [];
            if (req.query.view === 'Performance_Matrix') {
                // Fetch from GraphQL for this specific view
                console.log("Fetching Performance_Matrix via GraphQL...");
                allData = await graphqlService.queryView('Performance_Matrix');
                console.log(`[ProIoT] GraphQL returned ${allData.length} records`);
                if (allData.length > 0) {
                    console.log("[ProIoT] First Record:", JSON.stringify(allData[0], null, 2));
                }
            } else {
                // Default: Fetch from OneLake Parquet
                allData = await service.getData(config.oneLake.proIoT);
            }
            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] Response: Returning ${slicedData.length} records (from total ${total})`);

            res.json({
                success: true,
                data: slicedData,
                total: total,
                page: page,
                limit: limit
            });
        } catch (err) {
            logToFile(`[ProIoT] API Error: ${err.message}`);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    }

    async getServiceLines(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;

            logToFile(`[ProIoT] API Request: /api/service-lines?page=${page}&limit=${limit} (Source: GraphQL)`);

            // Fetch from GraphQL View [ServiceOrder_Table&Line]
            const rawData = await graphqlService.queryView('ServiceOrder_Table&Line');

            // View 'ServiceOrder_Table&Line' already contains all necessary filters:
            // - Stage: POST
            // - TransactionType: 2, 3
            // - Date: Current Month

            const total = rawData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = rawData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] Response: Returning ${slicedData.length} records (from total ${total})`);

            res.json({
                data: slicedData,
                total: total,
                page: page,
                limit: limit
            });
        } catch (err) {
            logToFile(`[ProIoT] API Error: ${err.message}`);
            res.status(500).json({ error: err.message });
        }
    }

    /**
     * Baht Per Head data source backed by Stored Procedure (GraphQL mutation).
     *
     * This endpoint calls the Fabric GraphQL mutation `executeServiceOrder_Income`
     * via `graphqlService.executeServiceOrderIncome()` and returns a paginated
     * list of rows shaped for the Baht Per Head page.
     *
     * GET /api/income?page=0&limit=100
     */
    async getIncome(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;

            logToFile(`[ProIoT] API Request: /api/income?page=${page}&limit=${limit}&FromDate=${req.query.FromDate}&ToDate=${req.query.ToDate}`);

            // Call stored procedure-backed mutation with query parameters (for date filtering)
            const allData = await graphqlService.executeServiceOrderIncome(req.query);

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] Baht Per Head Response: Returning ${slicedData.length} records (from total ${total})`);

            res.json({
                success: true,
                data: slicedData,
                total,
                page,
                limit
            });
        } catch (err) {
            logToFile(`[ProIoT] Baht Per Head API Error: ${err.message}`);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    }

    async getBahtPerHead(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;

            logToFile(`[ProIoT] API Request: /api/baht-per-head?page=${page}&limit=${limit}&FromDate=${req.query.FromDate}&ToDate=${req.query.ToDate}`);

            // Call stored procedure-backed mutation
            const allData = await graphqlService.executeServiceOrderBahtPerHead(req.query);

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] Baht Per Head Summary Response: Returning ${slicedData.length} records (from total ${total})`);

            res.json({
                success: true,
                data: slicedData,
                total,
                page,
                limit
            });
        } catch (err) {
            logToFile(`[ProIoT] Baht Per Head Summary API Error: ${err.message}`);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    }

    /**
     * QRCode data source from GraphQL View.
     * 
     * This endpoint fetches QRCode data for service orders from the GraphQL API.
     * Returns serviceorderid, description, bpc_tradename, and serviceobjectid.
     * 
     * GET /api/qrcode?page=0&limit=100
     */
    async getBarCode(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;
            const status = req.query.status; // Get status from query, undefined if not provided

            logToFile(`[ProIoT] API Request: /api/barcode?page=${page}&limit=${limit}&status=${status}`);

            // Call stored procedure-backed mutation
            const allData = await graphqlService.executeServiceOrderBarCode(status);

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] BarCode Response: Returning ${slicedData.length} records (from total ${total})`);

            res.json({
                success: true,
                data: slicedData,
                total,
                page,
                limit
            });
        } catch (err) {
            logToFile(`[ProIoT] BarCode API Error: ${err.message}`);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    }

    /**
     * Jobs Per Man data source backed by direct SQL execution.
     * GET /api/jobs-per-man?page=0&limit=100&FromDate=YYYY-MM-DD&ToDate=YYYY-MM-DD
     */
    async getJobsPerMan(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;
            const fromDate = req.query.FromDate;
            const toDate = req.query.ToDate;

            if (!fromDate || !toDate) {
                return res.status(400).json({
                    success: false,
                    message: 'FromDate and ToDate are required parameters.'
                });
            }

            logToFile(`[ProIoT] API Request: /api/jobs-per-man?page=${page}&limit=${limit}&FromDate=${fromDate}&ToDate=${toDate}`);

            // Call GraphQL service (Stored Procedure Mutation)
            const allData = await graphqlService.executeServiceOrderJobsPerMan(req.query);

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] Jobs Per Man Response: Returning ${slicedData.length} records (from total ${total})`);

            res.json({
                success: true,
                data: slicedData,
                total,
                page,
                limit
            });
        } catch (err) {
            logToFile(`[ProIoT] Jobs Per Man API Error: ${err.message}`);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    }

    /**
     * BN09 Internal Work data source backed by Stored Procedure (GraphQL query).
     * GET /api/bn09-internal-work?page=0&limit=100&StartDate=YYYY-MM-DD&EndDate=YYYY-MM-DD
     */
    async getBN09InternalWork(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;
            const startDate = req.query.StartDate;
            const endDate = req.query.EndDate;

            if (!startDate || !endDate) {
                return res.status(400).json({
                    success: false,
                    message: 'StartDate and EndDate are required parameters.'
                });
            }

            logToFile(`[ProIoT] API Request: /api/bn09-internal-work?page=${page}&limit=${limit}&StartDate=${startDate}&EndDate=${endDate}`);

            // Call GraphQL service (Stored Procedure Query)
            const allData = await graphqlService.executeBN09InternalWork(req.query);

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] BN09 Internal Work Response: Returning ${slicedData.length} records (from total ${total})`);

            res.json({
                success: true,
                data: slicedData,
                total,
                page,
                limit
            });
        } catch (err) {
            logToFile(`[ProIoT] BN09 Internal Work API Error: ${err.message}`);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    }

    /**
     * Service Object data source from GraphQL View.
     * 
     * This endpoint fetches Service Object data from the GraphQL API.
     * View: Smaserviceobjecttable_Internal_Work_NPSO
     * 
     * GET /api/service-objects-npso?page=0&limit=100
     */
    async getServiceObjects(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;

            logToFile(`[ProIoT] API Request: /api/service-objects-npso?page=${page}&limit=${limit}`);

            // Call GraphQL service (Generic View Query)
            const allData = await graphqlService.queryView('Smaserviceobjecttable_Internal_Work_NPSO');

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] Service Object Response: Returning ${slicedData.length} records (from total ${total})`);

            res.json({
                success: true,
                data: slicedData,
                total,
                page,
                limit
            });
        } catch (err) {
            logToFile(`[ProIoT] Service Object API Error: ${err.message}`);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    }

    /**
     * Service Object (Internal Work) data source from GraphQL View.
     * 
     * This endpoint fetches Service Object data from the GraphQL API.
     * View: Smaserviceobjecttable_Internal_Work
     * 
     * GET /api/service-objects-internal-work?page=0&limit=100
     */
    async getServiceObjectsInternalWork(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;

            logToFile(`[ProIoT] API Request: /api/service-objects-internal-work?page=${page}&limit=${limit}`);

            // Call GraphQL service (Generic View Query)
            const allData = await graphqlService.queryView('Smaserviceobjecttable_Internal_Work');

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] Service Object Internal Work Response: Returning ${slicedData.length} records (from total ${total})`);

            res.json({
                success: true,
                data: slicedData,
                total,
                page,
                limit
            });
        } catch (err) {
            logToFile(`[ProIoT] Service Object Internal Work API Error: ${err.message}`);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    }

    /**
     * Dispatch Pending data source from GraphQL View.
     * 
     * This endpoint fetches Dispatch Pending data from the GraphQL API.
     * View: Dispatch_Pending_Fountain
     * 
     * GET /api/dispatch-pending-fountain?page=0&limit=100
     */
    async getDispatchPending(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;

            logToFile(`[ProIoT] API Request: /api/dispatch-pending-fountain?page=${page}&limit=${limit}`);

            // Call GraphQL service (Generic View Query)
            const allData = await graphqlService.queryView('Dispatch_Pending_Fountain');

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const paginatedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] Dispatch_Pending_Fountain: Total records ${total}, returning ${paginatedData.length}`);

            res.json({
                success: true,
                data: paginatedData,
                page: page,
                limit: limit,
                total: total
            });
        } catch (err) {
            logToFile(`[ProIoT] Dispatch Pending API Error: ${err.message}`);
            res.status(500).json({ success: false, message: err.message });
        }
    }

    /**
     * Dispatch Pending New Customer data source from GraphQL View.
     * 
     * This endpoint fetches Dispatch Pending New Customer data from the GraphQL API.
     * View: Dispatch_Pending_New_Customer
     * 
     * GET /api/dispatch-pending-new-customer?page=0&limit=100
     */
    async getDispatchPendingNewCustomer(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;

            logToFile(`[ProIoT] API Request: /api/dispatch-pending-new-customer?page=${page}&limit=${limit}`);

            // Call GraphQL service (Generic View Query)
            const allData = await graphqlService.queryView('Dispatch_Pending_New_Customer');

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const paginatedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] Dispatch_Pending_New_Customer: Total records ${total}, returning ${paginatedData.length}`);

            res.json({
                success: true,
                data: paginatedData,
                page: page,
                limit: limit,
                total: total
            });
        } catch (err) {
            logToFile(`[ProIoT] Dispatch Pending New Customer API Error: ${err.message}`);
            res.status(500).json({ success: false, message: err.message });
        }
    }

    /**
     * Dispatch Pending Cooler data source from GraphQL View.
     * 
     * This endpoint fetches Dispatch Pending Cooler data from the GraphQL API.
     * View: Dispatch_Pending_Cooler
     * 
     * GET /api/dispatch-pending-cooler?page=0&limit=100
     */
    async getDispatchPendingCooler(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;

            logToFile(`[ProIoT] API Request: /api/dispatch-pending-cooler?page=${page}&limit=${limit}`);

            // Call GraphQL service (Generic View Query)
            const allData = await graphqlService.queryView('Dispatch_Pending_Cooler');

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const paginatedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] Dispatch_Pending_Cooler: Total records ${total}, returning ${paginatedData.length}`);

            res.json({
                success: true,
                data: paginatedData,
                page: page,
                limit: limit,
                total: total
            });
        } catch (err) {
            logToFile(`[ProIoT] Dispatch Pending Cooler API Error: ${err.message}`);
            res.status(500).json({ success: false, message: err.message });
        }
    }

    /**
     * Dispatch Pending data source from GraphQL View.
     * 
     * This endpoint fetches Dispatch Pending data from the GraphQL API.
     * View: Dispatch_Pending
     * 
     * GET /api/dispatch-pending?page=0&limit=100
     */
    async getDispatchPendingAll(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;

            logToFile(`[ProIoT] API Request: /api/dispatch-pending?page=${page}&limit=${limit}`);

            // Call GraphQL service (Generic View Query)
            const allData = await graphqlService.queryView('Dispatch_Pending');

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const paginatedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] Dispatch_Pending: Total records ${total}, returning ${paginatedData.length}`);

            res.json({
                success: true,
                data: paginatedData,
                page: page,
                limit: limit,
                total: total
            });
        } catch (err) {
            logToFile(`[ProIoT] Dispatch Pending API Error: ${err.message}`);
            res.status(500).json({ success: false, message: err.message });
        }
    }

    /**
     * Dispatch Plan Pending data source from GraphQL View.
     * 
     * This endpoint fetches Dispatch Plan Pending data from the GraphQL API.
     * View: Dispatch_Plan_Pending (INIT/INPR + ZC04/ZC09)
     * 
     * GET /api/dispatch-plan-pending?page=0&limit=100
     */
    async getDispatchPlanPending(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;

            logToFile(`[ProIoT] API Request: /api/dispatch-plan-pending?page=${page}&limit=${limit}`);

            // Call GraphQL service (Generic View Query)
            const allData = await graphqlService.queryView('Dispatch_Plan_Pending');

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const paginatedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] Dispatch_Plan_Pending: Total records ${total}, returning ${paginatedData.length}`);

            res.json({
                success: true,
                data: paginatedData,
                page: page,
                limit: limit,
                total: total
            });
        } catch (err) {
            logToFile(`[ProIoT] Dispatch Plan Pending API Error: ${err.message}`);
            res.status(500).json({ success: false, message: err.message });
        }
    }
    /**
     * Operation Evaluate Post/Fins data source backed by Stored Procedure.
     * GET /api/operation-evaluate-post-fins?page=0&limit=100&StartDate=YYYY-MM-DD&FinishDate=YYYY-MM-DD
     */
    async getOperationEvaluatePostFins(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;
            const startDate = req.query.StartDate;
            const finishDate = req.query.FinishDate;

            if (!startDate || !finishDate) {
                return res.status(400).json({
                    success: false,
                    message: 'StartDate and FinishDate are required parameters.'
                });
            }

            logToFile(`[ProIoT] API Request: /api/operation-evaluate-post-fins?page=${page}&limit=${limit}&StartDate=${startDate}&FinishDate=${finishDate}`);

            // Call GraphQL service (Stored Procedure Query)
            const allData = await graphqlService.executeOperationEvaluatePostFins(req.query);

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] Operation Evaluate Post/Fins Response: Returning ${slicedData.length} records (from total ${total})`);

            res.json({
                success: true,
                data: slicedData,
                total,
                page,
                limit
            });
        } catch (err) {
            logToFile(`[ProIoT] Operation Evaluate Post/Fins API Error: ${err.message}`);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    }
    /**
     * Operation Evaluate INPR/INIT data source backed by Stored Procedure.
     * GET /api/operation-evaluate-inpr-init?page=0&limit=100&StartDate=YYYY-MM-DD&FinishDate=YYYY-MM-DD
     */
    async getOperationEvaluateInprInit(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;
            const startDate = req.query.StartDate;
            const finishDate = req.query.FinishDate;

            if (!startDate || !finishDate) {
                return res.status(400).json({
                    success: false,
                    message: 'StartDate and FinishDate are required parameters.'
                });
            }

            logToFile(`[ProIoT] API Request: /api/operation-evaluate-inpr-init?page=${page}&limit=${limit}&StartDate=${startDate}&FinishDate=${finishDate}`);

            // Call GraphQL service (Stored Procedure Query)
            const allData = await graphqlService.executeOperationEvaluateInprInit(req.query);

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] Operation Evaluate INPR/INIT Response: Returning ${slicedData.length} records (from total ${total})`);

            res.json({
                success: true,
                data: slicedData,
                total,
                page,
                limit
            });
        } catch (err) {
            logToFile(`[ProIoT] Operation Evaluate INPR/INIT API Error: ${err.message}`);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    }

    /**
     * InventtableView data source backed by GraphQL query.
     * GET /api/inventtable-views?page=0&limit=100
     */
    async getInventtableViews(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;

            logToFile(`[ProIoT] API Request: /api/inventtable-views?page=${page}&limit=${limit}`);

            // Call GraphQL service
            const allData = await graphqlService.queryView('InventtableView');

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] InventtableView Response: Returning ${slicedData.length} records (from total ${total})`);

            res.json({
                success: true,
                data: slicedData,
                total,
                page,
                limit
            });
        } catch (err) {
            logToFile(`[ProIoT] InventtableView API Error: ${err.message}`);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    }
    /**
     * Inventtransfer data source backed by GraphQL query.
     * GET /api/inventtransfer?page=0&limit=100
     */
    async getInventtransfer(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;

            logToFile(`[ProIoT] API Request: /api/inventtransfer?page=${page}&limit=${limit}`);

            // Call GraphQL service
            const allData = await graphqlService.queryView('inventtransfer');

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] inventtransfer Response: Returning ${slicedData.length} records (from total ${total})`);

            res.json({
                success: true,
                data: slicedData,
                total,
                page,
                limit
            });
        } catch (err) {
            logToFile(`[ProIoT] inventtransfer API Error: ${err.message}`);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    }

    /**
     * Service Level Refurbish data source backed by GraphQL query.
     * GET /api/service-level-refurbish?page=0&limit=100
     */
    async getServiceLevelRefurbish(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;

            logToFile(`[ProIoT] API Request: /api/service-level-refurbish?page=${page}&limit=${limit}`);

            // Call GraphQL service
            const allData = await graphqlService.queryView('Service_Level_Refurbish');

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] Service Level Refurbish Response: Returning ${slicedData.length} records (from total ${total})`);

            res.json({
                success: true,
                data: slicedData,
                total,
                page,
                limit
            });
        } catch (err) {
            logToFile(`[ProIoT] Service Level Refurbish API Error: ${err.message}`);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    }

    /**
     * Service Line data source backed by GraphQL query.
     * GET /api/service_Line?page=0&limit=100
     */
    async getServiceLine(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;

            const serviceorderid = req.query.serviceorderid || '';
            logToFile(`[ProIoT] API Request: /api/service_Line?page=${page}&limit=${limit}&serviceorderid=${serviceorderid}`);

            // Call GraphQL service mapped to the SP
            const allData = await graphqlService.executeServiceLine(serviceorderid);

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] Service Line Response: Returning ${slicedData.length} records (from total ${total})`);

            res.json({
                success: true,
                data: slicedData,
                total,
                page,
                limit
            });
        } catch (err) {
            logToFile(`[ProIoT] Service Line API Error: ${err.message}`);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    }

    /**
     * Out Of Stock Inventsum data source backed by GraphQL query.
     * GET /api/out-of-stock-inventsum?page=0&limit=100
     */
    async getOutOfStockInventsum(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;

            logToFile(`[ProIoT] API Request: /api/out-of-stock-inventsum?page=${page}&limit=${limit}`);

            // Call GraphQL service
            const allData = await graphqlService.queryView('Out_Of_Stock_Inventsum');

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = allData.slice(startIndex, endIndex);

            logToFile(`[ProIoT] Out Of Stock Inventsum Response: Returning ${slicedData.length} records (from total ${total})`);

            res.json({
                success: true,
                data: slicedData,
                total,
                page,
                limit
            });
        } catch (err) {
            logToFile(`[ProIoT] Out Of Stock Inventsum API Error: ${err.message}`);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    }
}
module.exports = new ProIoTController();
