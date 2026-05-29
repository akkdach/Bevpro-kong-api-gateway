const syncService = require('../services/syncService');
const { logToFile } = require('../utils/logger');

class SyncController {
    async syncServiceOrderTable(req, res) {
        try {
            logToFile(`[SyncController] API Request: /api/sync/service-order-table-sync`);
            const result = await syncService.syncFromGraphQL('ServiceOrderTable_Import_DataBase_238', 'ServiceOrderTable_Sync', 'Id', 'modifiedon');
            res.json({ success: true, message: "Sync completed successfully", data: result });
        } catch (error) {
            logToFile(`[SyncController] API Error: ${error.message}`);
            res.status(500).json({ success: false, message: `Sync failed: ${error.message}` });
        }
    }

    async syncServiceOrderLine(req, res) {
        try {
            logToFile(`[SyncController] API Request: /api/sync/service-order-line-sync`);
            const result = await syncService.syncFromGraphQL('ServiceOrderLine_Import_DataBase_238', 'ServiceOrderLine_Sync', 'Id', 'modifiedon');
            res.json({ success: true, message: "ServiceOrderLine Sync completed successfully", data: result });
        } catch (error) {
            logToFile(`[SyncController] API Error (Line): ${error.message}`);
            res.status(500).json({ success: false, message: `ServiceOrderLine Sync failed: ${error.message}` });
        }
    }

    async syncServiceObjectTable(req, res) {
        try {
            logToFile(`[SyncController] API Request: /api/sync/service-object-table-sync`);
            const result = await syncService.syncFromGraphQL('ServiceObjectTable_Import_DataBase_238', 'ServiceObjectTable_Sync', 'Id', 'modifiedon');
            res.json({ success: true, message: "ServiceObjectTable Sync completed successfully", data: result });
        } catch (error) {
            logToFile(`[SyncController] API Error (ObjectTable): ${error.message}`);
            res.status(500).json({ success: false, message: `ServiceObjectTable Sync failed: ${error.message}` });
        }
    }

    async syncPickingroute(req, res) {
        try {
            logToFile(`[SyncController] API Request: /api/sync/pickingroute-sync`);
            const result = await syncService.syncFromGraphQL('Pickingroute_Import_DataBase_238', 'Pickingroute_Sync', 'Id', 'modifiedon');
            res.json({ success: true, message: "Pickingroute Sync completed successfully", data: result });
        } catch (error) {
            logToFile(`[SyncController] API Error (Pickingroute): ${error.message}`);
            res.status(500).json({ success: false, message: `Pickingroute Sync failed: ${error.message}` });
        }
    }

    async syncReasontable(req, res) {
        try {
            logToFile(`[SyncController] API Request: /api/sync/reasontable-sync`);
            const result = await syncService.syncFromGraphQL('Reasontable_Import_DataBase_238', 'Reasontable_Sync', 'Id', 'modifiedon');
            res.json({ success: true, message: "Reasontable Sync completed successfully", data: result });
        } catch (error) {
            logToFile(`[SyncController] API Error (Reasontable): ${error.message}`);
            res.status(500).json({ success: false, message: `Reasontable Sync failed: ${error.message}` });
        }
    }

    async syncLogisticspostaladdress(req, res) {
        try {
            logToFile(`[SyncController] API Request: /api/sync/logisticspostaladdress-sync`);
            const result = await syncService.syncFromGraphQL('Logisticspostaladdress_Import_DataBase_238', 'Logisticspostaladdress_Sync', 'Id', 'modifiedon');
            res.json({ success: true, message: "Logisticspostaladdress Sync completed successfully", data: result });
        } catch (error) {
            logToFile(`[SyncController] API Error (Postaladdress): ${error.message}`);
            res.status(500).json({ success: false, message: `Logisticspostaladdress Sync failed: ${error.message}` });
        }
    }

    async syncLogisticslocation(req, res) {
        try {
            logToFile(`[SyncController] API Request: /api/sync/logisticslocation-sync`);
            const result = await syncService.syncFromGraphQL('Logisticslocation_Import_DataBase_238', 'Logisticslocation_Sync', 'Id', 'modifiedon');
            res.json({ success: true, message: "Logisticslocation Sync completed successfully", data: result });
        } catch (error) {
            logToFile(`[SyncController] API Error (Location): ${error.message}`);
            res.status(500).json({ success: false, message: `Logisticslocation Sync failed: ${error.message}` });
        }
    }

    async syncInventtransorigin(req, res) {
        try {
            logToFile(`[SyncController] API Request: /api/sync/inventtransorigin-sync`);
            const result = await syncService.syncFromGraphQL('Inventtransorigin_Import_DataBase_238', 'Inventtransorigin_Sync', 'Id', 'modifiedon');
            res.json({ success: true, message: "Inventtransorigin Sync completed successfully", data: result });
        } catch (error) {
            logToFile(`[SyncController] API Error (Inventtransorigin): ${error.message}`);
            res.status(500).json({ success: false, message: `Inventtransorigin Sync failed: ${error.message}` });
        }
    }

    async syncInventtransfertable(req, res) {
        try {
            logToFile(`[SyncController] API Request: /api/sync/inventtransfertable-sync`);
            const result = await syncService.syncFromGraphQL('Inventtransfertable_Import_DataBase_238', 'Inventtransfertable_Sync', 'Id', 'modifiedon');
            res.json({ success: true, message: "Inventtransfertable Sync completed successfully", data: result });
        } catch (error) {
            logToFile(`[SyncController] API Error (Inventtransfertable): ${error.message}`);
            res.status(500).json({ success: false, message: `Inventtransfertable Sync failed: ${error.message}` });
        }
    }

    async syncInventtransferline(req, res) {
        try {
            logToFile(`[SyncController] API Request: /api/sync/inventtransferline-sync`);
            const result = await syncService.syncFromGraphQL('Inventtransferline_Import_DataBase_238', 'Inventtransferline_Sync', 'Id', 'modifiedon');
            res.json({ success: true, message: "Inventtransferline Sync completed successfully", data: result });
        } catch (error) {
            logToFile(`[SyncController] API Error (Inventtransferline): ${error.message}`);
            res.status(500).json({ success: false, message: `Inventtransferline Sync failed: ${error.message}` });
        }
    }

    async syncInventtrans(req, res) {
        try {
            logToFile(`[SyncController] API Request: /api/sync/inventtrans-sync`);
            const result = await syncService.syncFromGraphQL('Inventtrans_Import_DataBase_238', 'Inventtrans_Sync', 'Id', 'modifiedon');
            res.json({ success: true, message: "Inventtrans Sync completed successfully", data: result });
        } catch (error) {
            logToFile(`[SyncController] API Error (Inventtrans): ${error.message}`);
            res.status(500).json({ success: false, message: `Inventtrans Sync failed: ${error.message}` });
        }
    }
    async syncInventtable(req, res) {
        try {
            logToFile(`[SyncController] API Request: /api/sync/inventtable-sync`);
            const result = await syncService.syncFromGraphQL('Inventtable_Import_DataBase_238', 'Inventtable_Sync', 'Id', 'modifiedon');
            res.json({ success: true, message: "Inventtable Sync completed successfully", data: result });
        } catch (error) {
            logToFile(`[SyncController] API Error (Inventtable): ${error.message}`);
            res.status(500).json({ success: false, message: `Inventtable Sync failed: ${error.message}` });
        }
    }
    async syncInventsum(req, res) {
        try {
            logToFile(`[SyncController] API Request: /api/sync/inventsum-sync`);
            const result = await syncService.syncFromGraphQL('Inventsum_Import_DataBase_238', 'Inventsum_Sync', 'Id', 'modifiedon');
            res.json({ success: true, message: "Inventsum Sync completed successfully", data: result });
        } catch (error) {
            logToFile(`[SyncController] API Error (Inventsum): ${error.message}`);
            res.status(500).json({ success: false, message: `Inventsum Sync failed: ${error.message}` });
        }
    }
    async syncHcmworker(req, res) {
        try {
            logToFile(`[SyncController] API Request: /api/sync/hcmworker-sync`);
            const result = await syncService.syncFromGraphQL('Hcmworker_Import_DataBase_238', 'Hcmworker_Sync', 'Id', 'modifiedon');
            res.json({ success: true, message: "Hcmworker Sync completed successfully", data: result });
        } catch (error) {
            logToFile(`[SyncController] API Error (Hcmworker): ${error.message}`);
            res.status(500).json({ success: false, message: `Hcmworker Sync failed: ${error.message}` });
        }
    }
    async syncDirpersonname(req, res) {
        try {
            logToFile(`[SyncController] API Request: /api/sync/dirpersonname-sync`);
            const result = await syncService.syncFromGraphQL('Dirpersonname_Import_DataBase_238', 'Dirpersonname_Sync', 'Id', 'modifiedon');
            res.json({ success: true, message: "Dirpersonname Sync completed successfully", data: result });
        } catch (error) {
            logToFile(`[SyncController] API Error (Dirpersonname): ${error.message}`);
            res.status(500).json({ success: false, message: `Dirpersonname Sync failed: ${error.message}` });
        }
    }
    async syncDirperson(req, res) {
        try {
            logToFile(`[SyncController] API Request: /api/sync/dirperson-sync`);
            const result = await syncService.syncFromGraphQL('Dirperson_Import_DataBase_238', 'Dirperson_Sync', 'Id', 'modifiedon');
            res.json({ success: true, message: "Dirperson Sync completed successfully", data: result });
        } catch (error) {
            logToFile(`[SyncController] API Error (Dirperson): ${error.message}`);
            res.status(500).json({ success: false, message: `Dirperson Sync failed: ${error.message}` });
        }
    }
    async syncCusttable(req, res) {
        try {
            logToFile(`[SyncController] API Request: /api/sync/custtable-sync`);
            const result = await syncService.syncFromGraphQL('Custtable_Import_DataBase_238', 'Custtable_Sync', 'Id', 'modifiedon');
            res.json({ success: true, message: "Custtable Sync completed successfully", data: result });
        } catch (error) {
            logToFile(`[SyncController] API Error (Custtable): ${error.message}`);
            res.status(500).json({ success: false, message: `Custtable Sync failed: ${error.message}` });
        }
    }
    async syncMaintenanceactivitytype(req, res) {
        try {
            logToFile(`[SyncController] API Request: /api/sync/maintenanceactivitytype-sync`);
            const result = await syncService.syncFromGraphQL('Maintenanceactivitytype_Import_DataBase_238', 'Maintenanceactivitytype_Sync', 'Id', 'modifiedon');
            res.json({ success: true, message: "Maintenanceactivitytype Sync completed successfully", data: result });
        } catch (error) {
            logToFile(`[SyncController] API Error (Maintenanceactivitytype): ${error.message}`);
            res.status(500).json({ success: false, message: `Maintenanceactivitytype Sync failed: ${error.message}` });
        }
    }
}

module.exports = new SyncController();
