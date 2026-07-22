#!/usr/bin/env python3
"""
add-mobile-routes.py — เพิ่ม route เฉพาะเส้นที่แอป Mobile (BevProFS) ใช้จริง

ที่มา: endpoint_inventory_base_url.md — สแกนจาก services/**/*.ts ของโปรเจกต์ Mobile
base เดิมของแอป: https://service.bevproasia.com/api/v1  (EXPO_PUBLIC_API_BASE_URL)

ต่างจากรอบก่อน: รอบก่อนสแกน source ของ API แล้วเปิดทั้ง controller (116 กลุ่ม)
รอบนี้เปิดเฉพาะเส้นที่แอปเรียกจริง — /api/v1/Mobile มี 156 endpoints แต่แอปใช้ ~60
จึงแตกรายเส้นแทนการเปิด prefix ทั้งตัว

auth: บังคับ JWT ทุกเส้น ยกเว้นที่ backend ประกาศ [AllowAnonymous] ไว้จริง
      (เช็คจาก source C# แล้ว — ดู PUBLIC ด้านล่าง)

ใช้: python3 add-mobile-routes.py [--dry-run]
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

ADMIN = os.environ.get("KONG_ADMIN", "http://localhost:8001")
SERVICE = os.environ.get("BEVPRO_SERVICE", "bevpro-service")
TAG = "mobile-app"
DRY = "--dry-run" in sys.argv

G, P, PU, D = ["GET"], ["POST"], ["PUT"], ["DELETE"]

# (path, methods, public?)
# path ที่ลงท้ายด้วย {param} ตัดทิ้ง — Kong จับ prefix ครอบลูกให้เอง
ROUTES = [
    # ── 1. Auth / Config ──
    ("/api/v1/Authen/token",                     P,      True),   # login
    ("/api/v1/Gps/appSetting",                   G,      False),
    ("/api/v1/Mobile/profile",                   G,      False),

    # ── 2. Work Order ──
    ("/api/v1/Mobile/workorder",                 G,      False),
    ("/api/v1/Mobile/workorder_detail",          G,      False),
    ("/api/v1/Mobile/workorder_history",         G,      False),
    ("/api/v1/Mobile/customer_info",             G,      False),
    ("/api/v1/Mobile/GetWizardStepStatus",       G,      False),
    ("/api/v1/Mobile/SetWizardStepStatus",       P,      False),
    ("/api/v1/Mobile/get_simulate",              G,      False),
    ("/api/v1/Mobile/CheckOutWorkingTime",       G,      False),
    ("/api/v1/Mobile/GetWorkOrderCloseWork",     G,      False),
    ("/api/v1/Mobile/SetWorkOrderCloseWork",     P,      False),
    ("/api/v1/Mobile/GetCheckOutEquipmentNotMatch", G,   False),
    ("/api/v1/Mobile/SetCheckOutEquipmentNotMatch", P,   False),
    ("/api/v1/WorkOrderRoadMap",                 G,      True),   # AllowAnonymous
    ("/api/WizardConfig",                        G,      False),  # อยู่นอก /api/v1

    # ── 3. ปิดงาน ──
    ("/api/v1/Mobile/GetCheckOutCloseType",      G,      True),   # AllowAnonymous
    ("/api/v1/Mobile/SetCheckOutCloseType",      P,      False),
    ("/api/v1/Mobile/CheckOutOptionDdlCloseType", G,     False),
    ("/api/v1/close-type-update",                P,      True),   # AllowAnonymous
    ("/api/v1/master/close-types",               G,      True),   # AllowAnonymous
    ("/api/v1/Mobile/CheckOutLackOfSparePartsList", G,   False),
    ("/api/v1/Mobile/CheckOutLackOfSpareParts",  P,      False),

    # ── 4. Catalog ──
    ("/api/v1/Mobile/catalog_code_group",        G,      False),
    ("/api/v1/Mobile/catalog_code_group_damage", G,      False),
    ("/api/v1/Mobile/check_all_problem",         G,      True),   # AllowAnonymous
    ("/api/v1/Mobile/create_problem",            P,      True),   # AllowAnonymous

    # ── 5. เวลาทำงาน ──
    ("/api/v1/Mobile/MasterWorkOrderWorker",     G,      False),
    ("/api/v1/Mobile/MasterActivityTypeMas",     G,      False),
    ("/api/v1/Mobile/GetTimeOperationWorker",    G,      False),
    ("/api/v1/Mobile/SetTimeOperationWorker",    P,      False),

    # ── 6. อะไหล่ ──
    ("/api/v1/Mobile/GetWorkOrderSparePart",     G,      False),
    ("/api/v1/Mobile/SetWorkOrderSparePart",     P,      False),
    ("/api/v1/Mobile/StorageLocatStock",         G,      False),
    ("/api/v1/Mobile/TranferRequestFrom_ddl",    G,      False),
    ("/api/v1/Mobile/TranferRequestTo_ddl",      G,      False),
    ("/api/v1/Mobile/TranferRequestSparepartList", G,    False),
    ("/api/v1/Mobile/ReservationRequest_create", P,      False),
    ("/api/v1/Mobile/ReservationRequest_Waite",  P,      False),  # prefix ครอบ _Van/_7day/_Item ด้วย
    ("/api/v1/Mobile/ReservationRequest_approve", P,     False),  # + /{resId}
    ("/api/v1/Mobile/ReservationRequest_Cancel", P,      False),  # + /{resId}
    ("/api/v1/Mobile/TranferReceiveSparepartFromNav", P, False),
    ("/api/v1/Mobile/RemainingSparepart",        G,      False),
    ("/api/v1/Mobile/RemainingTools",            G,      False),
    ("/api/v1/Mobile/SynSpareBalance",           G,      False),
    ("/api/v1/Mobile/get_component_damage_claim", G,     False),
    ("/api/v1/master/part-set",                  G,      True),   # AllowAnonymous

    # ── 7. Checklist ──
    ("/api/v1/ChecklistMaster",                  G + P,  True),   # AllowAnonymous + ครอบ /Transaction
    ("/api/v1/Mobile/get_checklist_master_withdefault_valuecheck", G, False),
    ("/api/v1/Mobile/get_defect_checklist",      G,      False),
    ("/api/v1/Mobile/create_checkinglist",       P,      False),

    # ── 8. รูปภาพ ──
    ("/api/v1/Mobile/GetMasterWorkorderImage",   G,      False),
    ("/api/v1/Mobile/get_imageworkorder",        G,      False),
    ("/api/v1/Mobile/update_workorderImage",     P,      False),
    ("/api/v1/upload",                           P,      False),

    # ── 9. Inspector / Visitor ──
    ("/api/v1/VisitInspector",                   G,      False),  # /visit-inspector
    ("/api/v1/Mobile/workorder_visit_inspector", G + P,  False),
    ("/api/v1/Mobile/visitor",                   G + P + PU + D, False),
    ("/api/v1/Mobile/GetTimeOperationWorker_VisitInspector", G, False),
    ("/api/v1/Mobile/SetTimeOperationWorker_VisitInspector", P, False),
    ("/api/v1/Mobile/GetQualityIndex_VisitInspector", G, False),
    ("/api/v1/Mobile/SetQualityIndex_VisitInspector", P, False),
    ("/api/v1/Mobile/GetChecklist_VisitInspector", G,    False),
    ("/api/v1/Mobile/CreateCheckinglist_VisitInspector", P, False),
    ("/api/v1/Mobile/GetImageCheckList",         G,      False),
    ("/api/v1/Mobile/SetImageCheckList",         P,      False),
    ("/api/v1/Mobile/GetWorkOrderCloseWork_VisitInspector", G, False),
    ("/api/v1/Mobile/SetWorkOrderCloseWork_VisitInspector", P, False),
    ("/api/v1/Mobile/OperatingProcedures",       G,      False),
    ("/api/v1/Mobile/SetOperatingProcedures",    P,      False),
    ("/api/v1/Mobile/get_qi_defect",             G,      False),
    ("/api/v1/visit_inspector/upload",           P,      False),

    # ── 10. เลื่อนนัด / อนุมัติ ──
    ("/api/v1/WorkOrderPostponeReason",          G,      False),  # /list
    ("/api/v1/Mobile/request_work_order_activity", P,    False),
    ("/api/v1/Mobile/approve_work_order_activity", P,    False),
    ("/api/v1/Mobile/get_work_order_activity_log", G,    False),
    ("/api/v1/Mobile/get_subordinate_work_order_activities", G, False),
    ("/api/v1/Mobile/get_workorder_approve",     P,      False),
    ("/api/v1/Mobile/getunder_vansup",           P,      False),
    ("/api/v1/Mobile/action_approve",            P,      False),

    # ── 11. ลงเวลา / GPS ──
    ("/api/v1/Mobile/work_log",                  P,      False),  # /stampdayin_out
    ("/api/v1/clockin",                          G + P,  False),  # /check, /stamp
    ("/api/v1/Mobile/getVanBySup",               G,      False),

    # ── 12. ประกาศ (ยังไม่ deploy ที่ backend — route เตรียมไว้) ──
    ("/api/v1/Announcement",                     G,      False),

    # ── 13. อื่น ๆ ──
    ("/api/v1/notifications/unregister-token",   D,      False),
]


def req(method, url, data=None):
    body = urllib.parse.urlencode(data, doseq=True).encode() if data else None
    r = urllib.request.Request(url, data=body, method=method)
    if body:
        r.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()[:200]}
    except Exception as e:
        return 0, {"error": str(e)}


def slug(path):
    return ("mb-" + re.sub(r"[^a-zA-Z0-9]+", "-", path.strip("/")).strip("-").lower())[:60]


def main():
    print(f"routes ที่จะสร้าง: {len(ROUTES)}  (public {sum(1 for _, _, p in ROUTES if p)})")
    seen = {}
    for path, methods, pub in ROUTES:
        if path in seen:
            print(f"  !! path ซ้ำในลิสต์: {path}")
        seen[path] = True

    if DRY:
        for path, methods, pub in ROUTES:
            print(f"  {path:58} {','.join(methods):22} jwt={not pub}")
        return

    ok = fail = 0
    for path, methods, pub in ROUTES:
        name = slug(path)
        data = [("paths[]", path), ("strip_path", "false"), ("tags[]", TAG)] + \
               [("methods[]", m) for m in sorted(set(methods) | {"OPTIONS"})]
        code, body = req("PUT", f"{ADMIN}/services/{SERVICE}/routes/{name}", data)
        if code >= 400:
            print(f"  !! {path} -> HTTP {code} {body.get('error','')[:110]}")
            fail += 1
            continue
        ok += 1
        if not pub:
            _, pl = req("GET", f"{ADMIN}/routes/{name}/plugins")
            if not any(x["name"] == "jwt" for x in pl.get("data", [])):
                req("POST", f"{ADMIN}/routes/{name}/plugins", [
                    ("name", "jwt"),
                    ("config.key_claim_name", "iss"),
                    ("config.claims_to_verify[]", "exp"),
                ])

    print(f"สำเร็จ {ok} | พลาด {fail}")
    _, rts = req("GET", f"{ADMIN}/routes?size=500")
    d = rts.get("data", [])
    print(f"routes tag={TAG}: {sum(1 for r in d if TAG in (r.get('tags') or []))} | ทั้งระบบ: {len(d)}")


if __name__ == "__main__":
    main()
