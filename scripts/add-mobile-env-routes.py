#!/usr/bin/env python3
"""
add-mobile-env-routes.py — route ของแอป Mobile แยก UAT / PROD

  https://<gateway>/uat/<endpoint>   -> https://service.bevproasia.com:5001/api/v1/<endpoint>
  https://<gateway>/prod/<endpoint>  -> https://service.bevproasia.com/api/v1/<endpoint>

ทำไมต้องใช้ regex + request-transformer:
  service มี path /api/v1 ไม่ได้ เพราะ strip_path จะตัด route path ทั้งเส้นทิ้ง
  (route /uat/Mobile/workorder + strip -> upstream เหลือแค่ /api/v1 ตัว endpoint หาย)
  จึงใช้ regex จับส่วนท้าย แล้วให้ request-transformer ประกอบ uri ใหม่เอง
  รูปแบบ: ~/uat/<endpoint>(?<rest>/.*)?$  ->  /api/v1/<endpoint>$(uri_captures["rest"] or "")
  ส่วน (?<rest>...) ทำให้ path parameter เช่น /ReservationRequest_approve/55 ไม่หาย

onelake ไม่เกี่ยว ใช้ base เดิม https://<gateway>/api ต่อไป

ใช้: python3 add-mobile-env-routes.py [--dry-run]
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

ADMIN = os.environ.get("KONG_ADMIN", "http://localhost:8001")
DRY = "--dry-run" in sys.argv
TAG = "mobile-env"

ENVS = {
    "uat":  ("bevpro-uat",  "https://service.bevproasia.com:5001"),
    "prod": ("bevpro-prod", "https://service.bevproasia.com"),
}
UPSTREAM_PREFIX = "/api/v1"

G, P, PU, D = ["GET"], ["POST"], ["PUT"], ["DELETE"]

# (endpoint หลัง /api/v1, methods, public?)
ENDPOINTS = [
    ("/Authen/token",                      P,      True),
    ("/Gps/appSetting",                    G,      False),
    ("/Mobile/profile",                    G,      False),

    ("/Mobile/workorder",                  G,      False),
    ("/Mobile/workorder_detail",           G,      False),
    ("/Mobile/workorder_history",          G,      False),
    ("/Mobile/customer_info",              G,      False),
    ("/Mobile/GetWizardStepStatus",        G,      False),
    ("/Mobile/SetWizardStepStatus",        P,      False),
    ("/Mobile/get_simulate",               G,      False),
    ("/Mobile/CheckOutWorkingTime",        G,      False),
    ("/Mobile/GetWorkOrderCloseWork",      G,      False),
    ("/Mobile/SetWorkOrderCloseWork",      P,      False),
    ("/Mobile/GetCheckOutEquipmentNotMatch", G,    False),
    ("/Mobile/SetCheckOutEquipmentNotMatch", P,    False),
    ("/WorkOrderRoadMap",                  G,      True),

    ("/Mobile/GetCheckOutCloseType",       G,      False),
    ("/Mobile/SetCheckOutCloseType",       P,      False),
    ("/Mobile/CheckOutOptionDdlCloseType", G,      False),
    ("/close-type-update",                 P,      True),
    ("/master/close-types",                G,      True),
    ("/Mobile/CheckOutLackOfSparePartsList", G,    False),
    ("/Mobile/CheckOutLackOfSpareParts",   P,      False),

    ("/Mobile/catalog_code_group",         G,      False),
    ("/Mobile/catalog_code_group_damage",  G,      False),
    ("/Mobile/check_all_problem",          G,      False),
    ("/Mobile/create_problem",             P,      False),

    ("/Mobile/MasterWorkOrderWorker",      G,      False),
    ("/Mobile/MasterActivityTypeMas",      G,      False),
    ("/Mobile/GetTimeOperationWorker",     G,      False),
    ("/Mobile/SetTimeOperationWorker",     P,      False),

    ("/Mobile/GetWorkOrderSparePart",      G,      False),
    ("/Mobile/SetWorkOrderSparePart",      P,      False),
    ("/Mobile/StorageLocatStock",          G,      False),
    ("/Mobile/TranferRequestFrom_ddl",     G,      False),
    ("/Mobile/TranferRequestTo_ddl",       G,      False),
    ("/Mobile/TranferRequestSparepartList", G,     False),
    ("/Mobile/ReservationRequest_create",  P,      False),
    # _Waite / _Waite_Van / _Waite_7day / _Waite_Item เป็นคนละ endpoint
    # regex ลงท้าย (?<rest>/.*)?$ จับได้เฉพาะที่ต่อด้วย "/" — "_Van" จึงไม่เข้า ต้องแยกเส้น
    ("/Mobile/ReservationRequest_Waite",   P,      False),
    ("/Mobile/ReservationRequest_Waite_Van",  P,   False),
    ("/Mobile/ReservationRequest_Waite_7day", P,   False),
    ("/Mobile/ReservationRequest_Waite_Item", P,   False),   # + /{resId}
    ("/Mobile/ReservationRequest_approve", P,      False),   # + /{resId}
    ("/Mobile/ReservationRequest_Cancel",  P,      False),   # + /{resId}
    ("/Mobile/TranferReceiveSparepartFromNav", P,  False),
    ("/Mobile/RemainingSparepart",         G,      False),
    ("/Mobile/RemainingTools",             G,      False),
    ("/Mobile/SynSpareBalance",            G,      False),
    ("/Mobile/get_component_damage_claim", G,      False),
    ("/master/part-set",                   G,      True),

    ("/ChecklistMaster",                   G + P,  True),
    ("/Mobile/get_checklist_master_withdefault_valuecheck", G, False),
    ("/Mobile/get_defect_checklist",       G,      False),
    ("/Mobile/create_checkinglist",        P,      False),

    ("/Mobile/GetMasterWorkorderImage",    G,      False),
    ("/Mobile/get_imageworkorder",         G,      False),
    ("/Mobile/update_workorderImage",      P,      False),
    ("/upload",                            P,      False),

    ("/VisitInspector",                    G,      False),
    ("/Mobile/workorder_visit_inspector",  G + P,  False),
    ("/Mobile/visitor",                    G + P + PU + D, False),
    ("/Mobile/GetTimeOperationWorker_VisitInspector", G, False),
    ("/Mobile/SetTimeOperationWorker_VisitInspector", P, False),
    ("/Mobile/GetQualityIndex_VisitInspector", G,  False),
    ("/Mobile/SetQualityIndex_VisitInspector", P,  False),
    ("/Mobile/GetChecklist_VisitInspector", G,     False),
    ("/Mobile/CreateCheckinglist_VisitInspector", P, False),
    ("/Mobile/GetImageCheckList",          G,      False),
    ("/Mobile/SetImageCheckList",          P,      False),
    ("/Mobile/GetWorkOrderCloseWork_VisitInspector", G, False),
    ("/Mobile/SetWorkOrderCloseWork_VisitInspector", P, False),
    ("/Mobile/OperatingProcedures",        G,      False),
    ("/Mobile/SetOperatingProcedures",     P,      False),
    ("/Mobile/get_qi_defect",              G,      False),
    ("/visit_inspector/upload",            P,      False),

    ("/WorkOrderPostponeReason",           G,      False),
    ("/Mobile/request_work_order_activity", P,     False),
    ("/Mobile/approve_work_order_activity", P,     False),
    ("/Mobile/get_work_order_activity_log", G,     False),
    ("/Mobile/get_subordinate_work_order_activities", G, False),
    ("/Mobile/get_workorder_approve",      P,      False),
    ("/Mobile/getunder_vansup",            P,      False),
    ("/Mobile/action_approve",             P,      False),

    ("/Mobile/work_log",                   P,      False),
    ("/clockin",                           G + P,  False),
    ("/Mobile/getVanBySup",                G,      False),

    ("/Announcement",                      G,      False),
    ("/notifications/unregister-token",    D,      False),
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


def slug(env, ep):
    s = re.sub(r"[^a-zA-Z0-9]+", "-", ep.strip("/")).strip("-").lower()
    return f"mb-{env}-{s}"[:60]


def main():
    print(f"endpoints {len(ENDPOINTS)} x {len(ENVS)} env = {len(ENDPOINTS)*len(ENVS)} routes")
    if DRY:
        for env in ENVS:
            for ep, m, pub in ENDPOINTS[:3]:
                print(f"  /{env}{ep:48} -> {UPSTREAM_PREFIX}{ep}  jwt={not pub}")
            print("  ...")
        return

    for env, (svc, url) in ENVS.items():
        code, _ = req("PUT", f"{ADMIN}/services/{svc}", [
            ("url", url), ("connect_timeout", "10000"),
            ("read_timeout", "120000"), ("write_timeout", "120000"),
        ])
        print(f"service {svc:12} {url} -> HTTP {code}")

    total_ok = total_fail = 0
    for env, (svc, _) in ENVS.items():
        ok = fail = 0
        for ep, methods, pub in ENDPOINTS:
            name = slug(env, ep)
            # regex + capture ส่วนท้าย เพื่อไม่ให้ path parameter หาย
            # (?:/api/v1)? = รับได้ทั้ง 2 แบบ ขึ้นกับว่าแอปตั้ง base ยังไง
            #   base = https://gw/uat          -> /uat/Mobile/workorder
            #   base = https://gw/uat/api/v1   -> /uat/api/v1/Mobile/workorder
            # ของเดิม base มี /api/v1 อยู่แล้ว คนตั้งค่ามักเก็บไว้ ทำให้ 404
            path = f"~/{env}(?:/api/v1)?{ep}(?<rest>/.*)?$"
            data = [("paths[]", path), ("strip_path", "false"), ("tags[]", TAG)] + \
                   [("methods[]", m) for m in sorted(set(methods) | {"OPTIONS"})]
            code, body = req("PUT", f"{ADMIN}/services/{svc}/routes/{name}", data)
            if code >= 400:
                print(f"  !! [{env}] {ep} -> HTTP {code} {body.get('error','')[:100]}")
                fail += 1
                continue

            _, pl = req("GET", f"{ADMIN}/routes/{name}/plugins")
            have = {p["name"] for p in pl.get("data", [])}
            if "request-transformer" not in have:
                req("POST", f"{ADMIN}/routes/{name}/plugins", [
                    ("name", "request-transformer"),
                    ("config.replace.uri",
                     f'{UPSTREAM_PREFIX}{ep}$(uri_captures["rest"] or "")'),
                ])
            if not pub and "jwt" not in have:
                req("POST", f"{ADMIN}/routes/{name}/plugins", [
                    ("name", "jwt"),
                    ("config.key_claim_name", "iss"),
                    ("config.claims_to_verify[]", "exp"),
                ])
            ok += 1
        print(f"  [{env}] สำเร็จ {ok} | พลาด {fail}")
        total_ok += ok
        total_fail += fail

    print(f"\nรวม สำเร็จ {total_ok} | พลาด {total_fail}")
    _, rts = req("GET", f"{ADMIN}/routes?size=600")
    d = rts.get("data", [])
    print(f"routes tag={TAG}: {sum(1 for r in d if TAG in (r.get('tags') or []))} | ทั้งระบบ: {len(d)}")


if __name__ == "__main__":
    main()
