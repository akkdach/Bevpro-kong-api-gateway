#!/bin/bash
# =====================================================
# 📦 Copy OneLake Middleware into Kong project
# =====================================================
# รันสคริปต์นี้เพื่อ copy source code ของ OneLake Middleware
# มาไว้ใน ./onelake-middleware/ ของ Kong project
# เพื่อให้ docker-compose build ได้
# =====================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MIDDLEWARE_SRC="${1:-}"

if [ -z "$MIDDLEWARE_SRC" ]; then
    echo "❌ กรุณาระบุ path ของ OneLake Middleware source"
    echo ""
    echo "Usage:"
    echo "  bash scripts/copy-middleware.sh /path/to/onelake-middleware"
    echo ""
    echo "Example:"
    echo "  bash scripts/copy-middleware.sh ../onelake-middleware/onelake-middleware"
    exit 1
fi

if [ ! -f "$MIDDLEWARE_SRC/server.js" ]; then
    echo "❌ ไม่พบ server.js ใน $MIDDLEWARE_SRC"
    echo "   ตรวจสอบว่า path ถูกต้องและเป็นโฟลเดอร์ของ OneLake Middleware"
    exit 1
fi

TARGET_DIR="$PROJECT_DIR/onelake-middleware"

echo "📦 Copying OneLake Middleware..."
echo "   From: $MIDDLEWARE_SRC"
echo "   To:   $TARGET_DIR"
echo ""

# สร้างโฟลเดอร์ปลายทาง
mkdir -p "$TARGET_DIR"

# Copy ไฟล์ที่จำเป็น (ไม่รวม node_modules, log files, cache files)
rsync -av --progress \
  --exclude='node_modules' \
  --exclude='*.log' \
  --exclude='*.tar' \
  --exclude='data_cache_*.json' \
  --exclude='.vs' \
  --exclude='.vscode' \
  --exclude='.github' \
  --exclude='*.traineddata' \
  "$MIDDLEWARE_SRC/" "$TARGET_DIR/"

echo ""
echo "✅ Copy complete!"
echo ""
echo "📋 Next steps:"
echo "   1. ตรวจสอบ ./onelake-middleware/.env ว่ามีค่า config ครบ"
echo "   2. รัน: docker compose up -d"
echo "   3. รัน: bash scripts/setup-kong.sh"
