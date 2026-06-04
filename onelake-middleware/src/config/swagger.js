const swaggerSpec = {
    openapi: '3.0.0',
    info: {
        title: 'OneLake Middleware API',
        version: '1.0.12',
        description: 'Middleware API สำหรับเชื่อมต่อ Fabric OneLake, BevproFsQas SQL Server และ Microsoft Entra ID Login'
    },
    servers: [
        { url: 'http://localhost:3005', description: 'Local Development' },
        { url: 'http://localhost', description: 'Kong Gateway (Local)' }
    ],
    components: {
        securitySchemes: {
            BearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'ใส่ JWT Token ที่ได้จาก /api/auth/login'
            },
            BasicAuth: {
                type: 'http',
                scheme: 'basic',
                description: 'Basic Auth สำหรับ Request Status และ Sync APIs'
            }
        }
    },
    paths: {
        // ==================== Authentication ====================
        '/api/auth/login': {
            post: {
                tags: ['🔐 Authentication'],
                summary: 'Login ด้วย Entra ID Token',
                description: 'ส่ง Entra ID Access Token มา → Backend ตรวจสอบกับ Microsoft → ออก JWT ของระบบเราให้',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['token'],
                                properties: {
                                    token: { type: 'string', description: 'Entra ID Access Token จาก Frontend (MSAL)', example: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJS...' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Login สำเร็จ — ได้ JWT กลับมา',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        token: { type: 'string', description: 'Internal JWT Token' },
                                        user: {
                                            type: 'object',
                                            properties: {
                                                name: { type: 'string', example: 'Ronnachai P.' },
                                                email: { type: 'string', example: 'ronnachai@bevproasia.com' }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    '401': { description: 'Entra Token ไม่ถูกต้องหรือหมดอายุ' }
                }
            }
        },
        '/api/auth/me': {
            get: {
                tags: ['🔐 Authentication'],
                summary: 'ดึงข้อมูลผู้ใช้ที่ Login อยู่',
                security: [{ BearerAuth: [] }],
                responses: {
                    '200': {
                        description: 'ข้อมูลผู้ใช้',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        user: { type: 'string' },
                                        name: { type: 'string' },
                                        email: { type: 'string' }
                                    }
                                }
                            }
                        }
                    },
                    '401': { description: 'ไม่มี Token หรือ Token หมดอายุ' }
                }
            }
        },

        // ==================== Pro IoT Board ====================
        '/api/orders': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Orders',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Order data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/service-lines': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Service Lines',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Service Lines data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/income': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Income',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Income data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/baht-per-head': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Baht Per Head',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Baht per head data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/barcode': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Barcode',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Barcode data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/jobs-per-man': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Jobs Per Man',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Jobs per man data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/bn09-internal-work': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง BN09 Internal Work',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'BN09 Internal Work data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/service-objects-npso': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Service Objects (NPSO)',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Service Objects NPSO data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/service-objects-internal-work': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Service Objects Internal Work',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Service Objects Internal Work data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/dispatch-pending-fountain': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Dispatch Pending (Fountain)',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Dispatch Pending Fountain data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/dispatch-pending-new-customer': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Dispatch Pending (New Customer)',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Dispatch Pending New Customer data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/dispatch-pending-cooler': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Dispatch Pending (Cooler)',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Dispatch Pending Cooler data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/dispatch-pending': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Dispatch Pending (All)',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Dispatch Pending All data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/dispatch-plan-pending': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Dispatch Plan Pending',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Dispatch Plan Pending data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/operation-evaluate-post-fins': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Operation Evaluate (Post Fins)',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Operation Evaluate Post Fins data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/operation-evaluate-inpr-init': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Operation Evaluate (InPr Init)',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Operation Evaluate InPr Init data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/inventtable-views': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Inventtable Views',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Inventtable Views data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/inventtransfer': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Inventtransfer',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Inventtransfer data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/service-level-refurbish': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Service Level Refurbish',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Service Level Refurbish data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/out-of-stock-inventsum': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Out of Stock Inventsum',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Out of Stock Inventsum data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/service_Line': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Service Line (Execute)',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Service Line data' }, '401': { description: 'Unauthorized' } }
            }
        },

        // ==================== SQL Queries ====================
        '/api/bom-referbush': {
            get: {
                tags: ['🗃️ SQL Queries'],
                summary: 'ดึงข้อมูล BOM_Referbush จาก BevproFsQas',
                security: [{ BearerAuth: [] }],
                responses: {
                    '200': {
                        description: 'รายการ BOM_Referbush ทั้งหมด',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        data: { type: 'array', items: { type: 'object' } },
                                        total: { type: 'integer', example: 58 }
                                    }
                                }
                            }
                        }
                    },
                    '401': { description: 'Unauthorized' },
                    '500': { description: 'Database connection error' }
                }
            }
        },
        '/api/worker': {
            get: {
                tags: ['🗃️ SQL Queries'],
                summary: 'ดึงข้อมูล Worker',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Worker data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/work-log': {
            get: {
                tags: ['🗃️ SQL Queries'],
                summary: 'ดึง Work Log',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Work Log data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/work-center': {
            get: {
                tags: ['🗃️ SQL Queries'],
                summary: 'ดึง Work Center',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Work Center data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/van-fuel-avg': {
            get: {
                tags: ['🗃️ SQL Queries'],
                summary: 'ดึงค่าเฉลี่ยน้ำมันรถ Van',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Van Fuel Avg data' }, '401': { description: 'Unauthorized' } }
            }
        },

        // ==================== FSR Protal ====================
        '/api/fsr-protal/orders': {
            get: {
                tags: ['📋 FSR Protal'],
                summary: 'ดึง Service Orders (GraphQL)',
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: 'view', in: 'query', description: 'ชื่อ View ที่ต้องการ',
                        schema: {
                            type: 'string',
                            enum: ['Service_BN04_Install', 'Service_BN09_Remove', 'Service_BN15_Refurbish', 'Service_BN04_New', 'Service_BN09_New', 'service_BN15_New', 'Service_BN02_New', 'Service_New_B2B', 'Service_BN04_New_B2B', 'Service_BN09_New_B2B', 'Service_BN15_New_B2B'],
                            default: 'Service_New_B2B'
                        }
                    }
                ],
                responses: { '200': { description: 'รายการ Service Orders' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/service-header': {
            get: {
                tags: ['📋 FSR Protal'],
                summary: 'ดึง Service Header',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Service Header data' }, '401': { description: 'Unauthorized' } }
            }
        },

        // ==================== Request Status ====================
        '/api/request-status/{referencedPoNumber}': {
            get: {
                tags: ['📝 Request Status'],
                summary: 'ดึงสถานะ Request (Basic Auth)',
                description: 'ใช้ Basic Auth แทน JWT',
                security: [{ BasicAuth: [] }],
                parameters: [
                    { name: 'referencedPoNumber', in: 'path', required: true, schema: { type: 'string' }, example: 'PO12345' }
                ],
                responses: { '200': { description: 'Request status data' }, '401': { description: 'Unauthorized (Basic Auth)' } }
            }
        },

        // ==================== Report Tracking ====================
        '/api/report-tracking': {
            get: {
                tags: ['📈 Report Tracking'],
                summary: 'ดึง Report Tracking (SharePoint Excel)',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Report Tracking data' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/report-tracking/sheets': {
            get: {
                tags: ['📈 Report Tracking'],
                summary: 'ดึงรายการ Sheets ใน Report',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Report sheets list' }, '401': { description: 'Unauthorized' } }
            }
        },

        // ==================== Other (Generic GraphQL) ====================
        '/api/other': {
            get: {
                tags: ['🔗 Other'],
                summary: 'Generic GraphQL Query',
                security: [{ BearerAuth: [] }],
                parameters: [
                    { name: 'query', in: 'query', description: 'GraphQL query name', schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'Query result' }, '401': { description: 'Unauthorized' } }
            }
        },

        // ==================== Freeze Data ====================
        '/api/freeze-income': {
            post: {
                tags: ['❄️ Freeze Data'],
                summary: 'Freeze ข้อมูล Income ปัจจุบัน',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Frozen data saved' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/freeze-income/list': {
            get: {
                tags: ['❄️ Freeze Data'],
                summary: 'ดูรายการ Frozen Data ทั้งหมด',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'List of frozen files' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/freeze-income/summary/{filename}': {
            get: {
                tags: ['❄️ Freeze Data'],
                summary: 'ดู Summary ของ Frozen Data',
                security: [{ BearerAuth: [] }],
                parameters: [
                    { name: 'filename', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'Frozen data summary' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/freeze-income/{filename}': {
            get: {
                tags: ['❄️ Freeze Data'],
                summary: 'ดึง Frozen Data ตาม filename',
                security: [{ BearerAuth: [] }],
                parameters: [
                    { name: 'filename', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'Frozen data' }, '401': { description: 'Unauthorized' } }
            },
            delete: {
                tags: ['❄️ Freeze Data'],
                summary: 'ลบ Frozen Data',
                security: [{ BearerAuth: [] }],
                parameters: [
                    { name: 'filename', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'Deleted' }, '401': { description: 'Unauthorized' } }
            }
        },

        // ==================== Cache Income ====================
        '/api/cache-income': {
            post: {
                tags: ['💾 Cache Income'],
                summary: 'Cache ข้อมูล Income ลง Memory',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Cached' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/cache-income/list': {
            get: {
                tags: ['💾 Cache Income'],
                summary: 'ดูรายการ Cache ทั้งหมด',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'List of cached items' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/cache-income/summary/{key}': {
            get: {
                tags: ['💾 Cache Income'],
                summary: 'ดู Summary ของ Cache',
                security: [{ BearerAuth: [] }],
                parameters: [
                    { name: 'key', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'Cache summary' }, '401': { description: 'Unauthorized' } }
            }
        },
        '/api/cache-income/{key}': {
            delete: {
                tags: ['💾 Cache Income'],
                summary: 'ลบ Cache',
                security: [{ BearerAuth: [] }],
                parameters: [
                    { name: 'key', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'Deleted' }, '401': { description: 'Unauthorized' } }
            }
        },

        // ==================== Sync Data ====================
        '/api/sync/service-order-table-sync': {
            post: { tags: ['🔄 Sync Data'], summary: 'Sync Service Order Table', security: [{ BasicAuth: [] }], responses: { '200': { description: 'Sync result' }, '401': { description: 'Unauthorized' } } }
        },
        '/api/sync/service-order-line-sync': {
            post: { tags: ['🔄 Sync Data'], summary: 'Sync Service Order Line', security: [{ BasicAuth: [] }], responses: { '200': { description: 'Sync result' }, '401': { description: 'Unauthorized' } } }
        },
        '/api/sync/service-object-table-sync': {
            post: { tags: ['🔄 Sync Data'], summary: 'Sync Service Object Table', security: [{ BasicAuth: [] }], responses: { '200': { description: 'Sync result' }, '401': { description: 'Unauthorized' } } }
        },
        '/api/sync/pickingroute-sync': {
            post: { tags: ['🔄 Sync Data'], summary: 'Sync Pickingroute', security: [{ BasicAuth: [] }], responses: { '200': { description: 'Sync result' }, '401': { description: 'Unauthorized' } } }
        },
        '/api/sync/reasontable-sync': {
            post: { tags: ['🔄 Sync Data'], summary: 'Sync Reasontable', security: [{ BasicAuth: [] }], responses: { '200': { description: 'Sync result' }, '401': { description: 'Unauthorized' } } }
        },
        '/api/sync/logisticspostaladdress-sync': {
            post: { tags: ['🔄 Sync Data'], summary: 'Sync Logistics Postal Address', security: [{ BasicAuth: [] }], responses: { '200': { description: 'Sync result' }, '401': { description: 'Unauthorized' } } }
        },
        '/api/sync/logisticslocation-sync': {
            post: { tags: ['🔄 Sync Data'], summary: 'Sync Logistics Location', security: [{ BasicAuth: [] }], responses: { '200': { description: 'Sync result' }, '401': { description: 'Unauthorized' } } }
        },
        '/api/sync/inventtransorigin-sync': {
            post: { tags: ['🔄 Sync Data'], summary: 'Sync Inventtransorigin', security: [{ BasicAuth: [] }], responses: { '200': { description: 'Sync result' }, '401': { description: 'Unauthorized' } } }
        },
        '/api/sync/inventtransfertable-sync': {
            post: { tags: ['🔄 Sync Data'], summary: 'Sync Inventtransfertable', security: [{ BasicAuth: [] }], responses: { '200': { description: 'Sync result' }, '401': { description: 'Unauthorized' } } }
        },
        '/api/sync/inventtransferline-sync': {
            post: { tags: ['🔄 Sync Data'], summary: 'Sync Inventtransferline', security: [{ BasicAuth: [] }], responses: { '200': { description: 'Sync result' }, '401': { description: 'Unauthorized' } } }
        },
        '/api/sync/inventtrans-sync': {
            post: { tags: ['🔄 Sync Data'], summary: 'Sync Inventtrans', security: [{ BasicAuth: [] }], responses: { '200': { description: 'Sync result' }, '401': { description: 'Unauthorized' } } }
        },
        '/api/sync/inventtable-sync': {
            post: { tags: ['🔄 Sync Data'], summary: 'Sync Inventtable', security: [{ BasicAuth: [] }], responses: { '200': { description: 'Sync result' }, '401': { description: 'Unauthorized' } } }
        },
        '/api/sync/inventsum-sync': {
            post: { tags: ['🔄 Sync Data'], summary: 'Sync Inventsum', security: [{ BasicAuth: [] }], responses: { '200': { description: 'Sync result' }, '401': { description: 'Unauthorized' } } }
        },
        '/api/sync/hcmworker-sync': {
            post: { tags: ['🔄 Sync Data'], summary: 'Sync HCM Worker', security: [{ BasicAuth: [] }], responses: { '200': { description: 'Sync result' }, '401': { description: 'Unauthorized' } } }
        },
        '/api/sync/dirpersonname-sync': {
            post: { tags: ['🔄 Sync Data'], summary: 'Sync Dir Person Name', security: [{ BasicAuth: [] }], responses: { '200': { description: 'Sync result' }, '401': { description: 'Unauthorized' } } }
        },
        '/api/sync/dirperson-sync': {
            post: { tags: ['🔄 Sync Data'], summary: 'Sync Dir Person', security: [{ BasicAuth: [] }], responses: { '200': { description: 'Sync result' }, '401': { description: 'Unauthorized' } } }
        },
        '/api/sync/custtable-sync': {
            post: { tags: ['🔄 Sync Data'], summary: 'Sync Custtable', security: [{ BasicAuth: [] }], responses: { '200': { description: 'Sync result' }, '401': { description: 'Unauthorized' } } }
        },
        '/api/sync/maintenanceactivitytype-sync': {
            post: { tags: ['🔄 Sync Data'], summary: 'Sync Maintenance Activity Type', security: [{ BasicAuth: [] }], responses: { '200': { description: 'Sync result' }, '401': { description: 'Unauthorized' } } }
        }
    }
};

module.exports = swaggerSpec;
