const cron = require('node-cron');
const syncService = require('../services/syncService');
const { logToFile } = require('../utils/logger');

function initCronJobs() {
    logToFile('[Cron] Initializing scheduled jobs...');

    // Run every day at 23:00 (11:00 PM / ห้าทุ่ม)
    cron.schedule('0 23 * * *', async () => {
        const syncTasks = [
            { view: 'ServiceOrderTable_Import_DataBase_238', table: 'ServiceOrderTable_Sync', label: 'ServiceOrderTable' },
            { view: 'ServiceOrderLine_Import_DataBase_238', table: 'ServiceOrderLine_Sync', label: 'ServiceOrderLine' },
            { view: 'ServiceObjectTable_Import_DataBase_238', table: 'ServiceObjectTable_Sync', label: 'ServiceObjectTable' },
            { view: 'Pickingroute_Import_DataBase_238', table: 'Pickingroute_Sync', label: 'Pickingroute' },
            { view: 'Reasontable_Import_DataBase_238', table: 'Reasontable_Sync', label: 'Reasontable' },
            { view: 'Logisticspostaladdress_Import_DataBase_238', table: 'Logisticspostaladdress_Sync', label: 'Logisticspostaladdress' },
            { view: 'Logisticslocation_Import_DataBase_238', table: 'Logisticslocation_Sync', label: 'Logisticslocation' },
            { view: 'Inventtransorigin_Import_DataBase_238', table: 'Inventtransorigin_Sync', label: 'Inventtransorigin' },
            { view: 'Inventtransfertable_Import_DataBase_238', table: 'Inventtransfertable_Sync', label: 'Inventtransfertable' },
            { view: 'Inventtransferline_Import_DataBase_238', table: 'Inventtransferline_Sync', label: 'Inventtransferline' },
            { view: 'Inventtrans_Import_DataBase_238', table: 'Inventtrans_Sync', label: 'Inventtrans' },
            { view: 'Inventtable_Import_DataBase_238', table: 'Inventtable_Sync', label: 'Inventtable' },
            { view: 'Inventsum_Import_DataBase_238', table: 'Inventsum_Sync', label: 'Inventsum' },
            { view: 'Hcmworker_Import_DataBase_238', table: 'Hcmworker_Sync', label: 'Hcmworker' },
            { view: 'Dirpersonname_Import_DataBase_238', table: 'Dirpersonname_Sync', label: 'Dirpersonname' },
            { view: 'Dirperson_Import_DataBase_238', table: 'Dirperson_Sync', label: 'Dirperson' },
            { view: 'Custtable_Import_DataBase_238', table: 'Custtable_Sync', label: 'Custtable' },
            { view: 'Maintenanceactivitytype_Import_DataBase_238', table: 'Maintenanceactivitytype_Sync', label: 'Maintenanceactivitytype' },
        ];

        logToFile(`\n======================================================`);
        logToFile(`[Cron] STARTING DAILY SYNC PROCESS FOR 18 TABLES`);
        logToFile(`======================================================\n`);

        let successCount = 0;
        let failCount = 0;

        for (const task of syncTasks) {
            logToFile(`\n------------------------------------------------------`);
            logToFile(`🚀 [Cron][START] Syncing table: ${task.label}`);
            logToFile(`------------------------------------------------------`);
            
            try {
                const startTime = Date.now();
                const result = await syncService.syncFromGraphQL(task.view, task.table, 'Id', 'modifiedon');
                const durationStr = ((Date.now() - startTime) / 1000).toFixed(2);
                
                logToFile(`✅ [Cron][SUCCESS] ${task.label} Sync completed in ${durationStr} seconds.`);
                logToFile(`   -> Mode: ${result.mode}, Inserted: ${result.inserted || 0}, Modified: ${result.modified || 0}`);
                successCount++;
            } catch (error) {
                logToFile(`❌ [Cron][FAILED] ${task.label} Sync failed!`);
                logToFile(`   -> Reason: ${error.message}`);
                failCount++;
            }
        }

        logToFile(`\n======================================================`);
        logToFile(`[Cron] DAILY SYNC PROCESS FINISHED`);
        logToFile(`-> Successful: ${successCount} tables`);
        logToFile(`-> Failed: ${failCount} tables`);
        logToFile(`======================================================\n`);
    }, {
        scheduled: true,
        timezone: "Asia/Bangkok"
    });

    logToFile('[Cron] Scheduled job set for 23:00 (Asia/Bangkok) every day — 18 table sync.');
}

module.exports = { initCronJobs };
