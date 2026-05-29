const express = require('express');
const router = express.Router();
const proIoTController = require('../controllers/proIoTController');
const fsrProtalController = require('../controllers/fsrProtalController_graphql'); // Using GraphQL API (Port 443)
const reportController = require('../controllers/reportController');
const otherController = require('../controllers/otherController');

// Project: Pro IoT Board

// Project: Pro IoT Board
router.get('/orders', (req, res) => proIoTController.getOrders(req, res));
router.get('/service-lines', (req, res) => proIoTController.getServiceLines(req, res));
router.get('/income', (req, res) => proIoTController.getIncome(req, res));
router.get('/baht-per-head', (req, res) => proIoTController.getBahtPerHead(req, res));
router.get('/barcode', (req, res) => proIoTController.getBarCode(req, res));
router.get('/jobs-per-man', (req, res) => proIoTController.getJobsPerMan(req, res));
router.get('/bn09-internal-work', (req, res) => proIoTController.getBN09InternalWork(req, res));
router.get('/service-objects-npso', (req, res) => proIoTController.getServiceObjects(req, res));
router.get('/service-objects-internal-work', (req, res) => proIoTController.getServiceObjectsInternalWork(req, res));
router.get('/dispatch-pending-fountain', (req, res) => proIoTController.getDispatchPending(req, res));
router.get('/dispatch-pending-new-customer', (req, res) => proIoTController.getDispatchPendingNewCustomer(req, res));
router.get('/dispatch-pending-cooler', (req, res) => proIoTController.getDispatchPendingCooler(req, res));
router.get('/dispatch-pending', (req, res) => proIoTController.getDispatchPendingAll(req, res));
router.get('/dispatch-plan-pending', (req, res) => proIoTController.getDispatchPlanPending(req, res));
router.get('/operation-evaluate-post-fins', (req, res) => proIoTController.getOperationEvaluatePostFins(req, res));
router.get('/operation-evaluate-inpr-init', (req, res) => proIoTController.getOperationEvaluateInprInit(req, res));
router.get('/inventtable-views', (req, res) => proIoTController.getInventtableViews(req, res));
router.get('/inventtransfer', (req, res) => proIoTController.getInventtransfer(req, res));
router.get('/service-level-refurbish', (req, res) => proIoTController.getServiceLevelRefurbish(req, res));
router.get('/out-of-stock-inventsum', (req, res) => proIoTController.getOutOfStockInventsum(req, res));
router.get('/service_Line', (req, res) => proIoTController.getServiceLine(req, res));

// Project: Other SQL Queries (Not FSR Protal)
const fsrProtalControllerSql = require('../controllers/fsrProtalController_sql');
router.get('/bom-referbush', (req, res) => fsrProtalControllerSql.getBomReferbush(req, res));
router.get('/worker', (req, res) => fsrProtalControllerSql.getWorker(req, res));
router.get('/work-log', (req, res) => fsrProtalControllerSql.getWorkLog(req, res));
router.get('/work-center', (req, res) => fsrProtalControllerSql.getWorkCenter(req, res));
router.get('/van-fuel-avg', (req, res) => fsrProtalControllerSql.getVanFuelAvg(req, res));

// Project: FSR Protal
router.get('/fsr-protal/orders', (req, res) => fsrProtalController.getOrders(req, res));
router.get('/service-header', (req, res) => fsrProtalController.getServiceHeader(req, res));

// Project: Report Tracking (SharePoint Excel)
router.get('/report-tracking', (req, res) => reportController.getReportTracking(req, res));
router.get('/report-tracking/sheets', (req, res) => reportController.getReportSheets(req, res));

// Project: Other (Generic GraphQL Query)
router.get('/other', (req, res) => otherController.getData(req, res));

// Project: Freeze Data (Total Income)
const freezeController = require('../controllers/freezeController');
router.post('/freeze-income', (req, res) => freezeController.freezeData(req, res));
router.get('/freeze-income/list', (req, res) => freezeController.listFrozenData(req, res));
router.get('/freeze-income/summary/:filename', (req, res) => freezeController.getFrozenSummary(req, res));
router.get('/freeze-income/:filename', (req, res) => freezeController.getFrozenData(req, res));
router.delete('/freeze-income/:filename', (req, res) => freezeController.deleteFrozenData(req, res));

// Cache Income (In-Memory Summary)
const cacheController = require('../controllers/cacheController');
router.post('/cache-income', (req, res) => cacheController.cacheData(req, res));
router.get('/cache-income/list', (req, res) => cacheController.listCached(req, res));
router.get('/cache-income/summary/:key', (req, res) => cacheController.getCachedSummary(req, res));
router.delete('/cache-income/:key', (req, res) => cacheController.deleteCache(req, res));

module.exports = router;
