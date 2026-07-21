#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# ตั้งค่า Azure NSG สำหรับ Kong API Gateway VM
#
# NSG เป็น resource ฝั่ง Azure (control plane) — ไม่ได้ตั้งใน OS ของ VM
# รันสคริปต์นี้ได้จาก:
#   - Azure Cloud Shell (แนะนำ — az login ให้อยู่แล้ว): https://shell.azure.com
#   - บน VM เอง หรือเครื่องไหนก็ได้ที่ติดตั้ง az CLI + `az login` แล้ว
#
# วิธีใช้:
#   RG=my-rg VM_NAME=kong-vm ADMIN_IP=1.2.3.4/32 bash scripts/setup-nsg.sh
#
# หลักการ:
#   - 80/443  → เปิดให้ผู้ใช้ (Internet หรือ CIDR องค์กร)
#   - 22      → เฉพาะ IP แอดมิน
#   - 8001/8002/1337/3000/9090 → เฉพาะ IP แอดมิน (Admin API + Dashboards)
#   - พอร์ตอื่น (5432, 3001, 8100) → ไม่เปิดเลย (default DenyAllInbound จัดการ)
#
# ⚠️ สำคัญ: ufw/iptables บน VM ถูก Docker bypass ได้ (Docker เขียน iptables เอง)
#    NSG อยู่ "นอก" VM จึงเป็น firewall ที่เชื่อถือได้จริงสำหรับ container ports
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

RG="${RG:?ต้องกำหนด RG=<resource-group>}"
VM_NAME="${VM_NAME:?ต้องกำหนด VM_NAME=<ชื่อ VM>}"
ADMIN_IP="${ADMIN_IP:?ต้องกำหนด ADMIN_IP=<ip>/32 (IP ออฟฟิศ/บ้านของแอดมิน)}"
# ที่มาของ traffic ผู้ใช้พอร์ต 80/443 — "Internet" = เปิดสาธารณะ
# ถ้าผู้ใช้ 400 คนออกเน็ตผ่าน IP องค์กร ให้ใส่ CIDR เช่น "203.0.113.0/24"
USER_SOURCE="${USER_SOURCE:-Internet}"

# ── หา NSG ที่ผูกกับ VM (จาก NIC ก่อน ถ้าไม่มีลองที่ subnet) ──
NIC_ID=$(az vm show -g "$RG" -n "$VM_NAME" \
  --query "networkProfile.networkInterfaces[0].id" -o tsv)
NSG_ID=$(az network nic show --ids "$NIC_ID" \
  --query "networkSecurityGroup.id" -o tsv)

if [ -z "$NSG_ID" ]; then
  SUBNET_ID=$(az network nic show --ids "$NIC_ID" \
    --query "ipConfigurations[0].subnet.id" -o tsv)
  NSG_ID=$(az network vnet subnet show --ids "$SUBNET_ID" \
    --query "networkSecurityGroup.id" -o tsv)
fi

if [ -z "$NSG_ID" ]; then
  echo "❌ ไม่พบ NSG ที่ผูกกับ NIC หรือ subnet ของ VM '$VM_NAME'"
  echo "   สร้างก่อนด้วย: az network nsg create -g $RG -n ${VM_NAME}-nsg"
  echo "   แล้วผูกกับ NIC: az network nic update --ids $NIC_ID --network-security-group ${VM_NAME}-nsg"
  exit 1
fi

NSG_NAME="${NSG_ID##*/}"
NSG_RG=$(echo "$NSG_ID" | cut -d'/' -f5)
echo "✅ พบ NSG: $NSG_NAME (resource group: $NSG_RG)"

# rule <ชื่อ> <priority> <source> <พอร์ต...>
rule() {
  local name="$1" prio="$2" src="$3"; shift 3
  echo "  → $name (priority $prio, source $src, ports: $*)"
  az network nsg rule create -g "$NSG_RG" --nsg-name "$NSG_NAME" \
    -n "$name" --priority "$prio" \
    --direction Inbound --access Allow --protocol Tcp \
    --source-address-prefixes "$src" \
    --destination-port-ranges "$@" -o none
}

echo "── สร้าง/อัปเดต rules (ชื่อซ้ำ = อัปเดตทับ) ──"
rule Allow-SSH-AdminOnly    100 "$ADMIN_IP"    22
rule Allow-Kong-HTTP        200 "$USER_SOURCE" 80
rule Allow-Kong-HTTPS       210 "$USER_SOURCE" 443
# 8001 จำเป็นต่อ Kong Manager (หน้าเว็บ :8002 ยิง XHR หา Admin API :8001 ตรงจาก browser)
rule Allow-Admin-Dashboards 300 "$ADMIN_IP"    8001 8002 1337 3000 9090

# กันเหนียว: Deny พอร์ตอ่อนไหวแบบ explicit (เผื่อวันหลังมีใครเพิ่ม allow กว้าง ๆ ทับ)
echo "  → Deny-Sensitive-Ports (priority 4000)"
az network nsg rule create -g "$NSG_RG" --nsg-name "$NSG_NAME" \
  -n Deny-Sensitive-Ports --priority 4000 \
  --direction Inbound --access Deny --protocol "*" \
  --source-address-prefixes "*" \
  --destination-port-ranges 5432 3001 8100 -o none

# ── ตรวจ rule เดิมที่อาจเปิดกว้างเกิน (เช่น default-allow-ssh ตอนสร้าง VM) ──
echo ""
echo "── Rules ทั้งหมดใน NSG (ตรวจว่าไม่มี Allow แปลกปลอมเปิด Any→22 หรือพอร์ต DB) ──"
az network nsg rule list -g "$NSG_RG" --nsg-name "$NSG_NAME" \
  --query "sort_by([].{Name:name, Prio:priority, Access:access, Src:join(',', sourceAddressPrefixes || [sourceAddressPrefix]), Ports:join(',', destinationPortRanges || [destinationPortRange])}, &Prio)" \
  -o table

echo ""
echo "ถ้าเจอ rule เก่าที่เปิด SSH จาก Any (มักชื่อ 'default-allow-ssh' หรือ 'SSH') ให้ลบ:"
echo "  az network nsg rule delete -g $NSG_RG --nsg-name $NSG_NAME -n <ชื่อ-rule>"
