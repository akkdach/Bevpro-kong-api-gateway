const swaggerSpec = {
    openapi: '3.0.0',
    info: {
        title: 'OneLake Middleware API',
        version: '1.0.12',
        description: 'Middleware API สำหรับเชื่อมต่อ Fabric OneLake, BevproFsQas SQL Server และ Microsoft Entra ID Login'
    },
    servers: [
        { url: 'http://localhost:3005', description: 'Local Development' }
    ],
    components: {
        securitySchemes: {
            BearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'ใส่ JWT Token ที่ได้จาก /api/auth/login'
            }
        }
    },
    paths: {
        // ========== Auth ==========
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
                                    token: {
                                        type: 'string',
                                        description: 'Entra ID Access Token จาก Frontend (MSAL)',
                                        example: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJS...'
                                    }
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

        // ========== BOM Referbush ==========
        '/api/bom-referbush': {
            get: {
                tags: ['📦 BOM Referbush'],
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
                                        data: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    Id: { type: 'integer', example: 1 },
                                                    ServiceOrderTypeCode: { type: 'string', example: 'ZC15' },
                                                    StandardServiceCode: { type: 'string', example: 'ZC15-0003' },
                                                    LineNo: { type: 'integer', example: 10000 },
                                                    Type: { type: 'string', example: 'Item' },
                                                    No: { type: 'string', example: '17017326' },
                                                    Description: { type: 'string' },
                                                    Quantity: { type: 'number', example: 1 },
                                                    UnitOfMeasureCode: { type: 'string', example: 'PCE' },
                                                    MIMJ: { type: 'string', example: 'Major A3' },
                                                    DescEng: { type: 'string' },
                                                    ModelNo: { type: 'string', example: '40000019' },
                                                    ServiceObjectGroup: { type: 'string', example: 'TCO' }
                                                }
                                            }
                                        },
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

        // ========== FSR Protal ==========
        '/api/fsr-protal/orders': {
            get: {
                tags: ['📋 FSR Protal'],
                summary: 'ดึง Service Orders (GraphQL)',
                security: [{ BearerAuth: [] }],
                parameters: [
                    {
                        name: 'view',
                        in: 'query',
                        description: 'ชื่อ View ที่ต้องการ',
                        schema: {
                            type: 'string',
                            enum: [
                                'Service_BN04_Install', 'Service_BN09_Remove', 'Service_BN15_Refurbish',
                                'Service_BN04_New', 'Service_BN09_New', 'service_BN15_New',
                                'Service_BN02_New', 'Service_New_B2B',
                                'Service_BN04_New_B2B', 'Service_BN09_New_B2B', 'Service_BN15_New_B2B'
                            ],
                            default: 'Service_New_B2B'
                        }
                    }
                ],
                responses: {
                    '200': { description: 'รายการ Service Orders' },
                    '401': { description: 'Unauthorized' }
                }
            }
        },
        '/api/service-header': {
            get: {
                tags: ['📋 FSR Protal'],
                summary: 'ดึง Service Header',
                security: [{ BearerAuth: [] }],
                responses: {
                    '200': { description: 'Service Header data' },
                    '401': { description: 'Unauthorized' }
                }
            }
        },

        // ========== Pro IoT ==========
        '/api/orders': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Orders',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Order data' } }
            }
        },
        '/api/income': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Income',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Income data' } }
            }
        },
        '/api/baht-per-head': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Baht Per Head',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Baht per head data' } }
            }
        },
        '/api/dispatch-pending': {
            get: {
                tags: ['📊 Pro IoT Board'],
                summary: 'ดึง Dispatch Pending (All)',
                security: [{ BearerAuth: [] }],
                responses: { '200': { description: 'Dispatch pending data' } }
            }
        },

        // ========== Request Status ==========
        '/api/request-status/{referencedPoNumber}': {
            get: {
                tags: ['📝 Request Status'],
                summary: 'ดึงสถานะ Request (Basic Auth)',
                description: 'ใช้ Basic Auth แทน JWT',
                security: [],
                parameters: [
                    {
                        name: 'referencedPoNumber',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' },
                        example: 'PO12345'
                    }
                ],
                responses: {
                    '200': { description: 'Request status data' },
                    '401': { description: 'Unauthorized (Basic Auth)' }
                }
            }
        }
    }
};

module.exports = swaggerSpec;
