"""Generate two Grafana dashboards for the SIMS <-> SAP integration through Kong.

  kong-sims-to-sap.json : SIMS -> Kong /sap-pi, /sap-pi-uat (qbx QAS) · /sap-pi-prod (pbx PRD) -> SAP PI
  kong-sap-to-sims.json : SAP PI -> Kong /sims-uat/api/v1/integrations/sap/service-orders -> SIMS

Usage (from repo root):
  python scripts/gen-sims-sap-dashboards.py monitoring/grafana/dashboards /tmp/queries.json
Then copy the two JSON files to the VM (see DEPLOY.md) — Grafana reloads them within 30 s.
queries.json = every rawSql, for validating against kong_api_logs before deploy.
"""
import json
import os
import sys

OUT_DIR = sys.argv[1]
QUERIES_OUT = sys.argv[2]
PG = {"type": "postgres", "uid": "konglogs"}

# Who is calling — known sources seen in kong_api_logs (2026-10-07). Unknown = check whether it is SIMS / SAP.
CALLER = (
    "CASE "
    "WHEN user_agent ILIKE '%SAP%' THEN 'SAP PI (user agent)' "
    "WHEN client_ip LIKE '119.63.88.%' THEN 'เครือข่าย Thai Namthip' "
    "WHEN client_ip = '127.0.0.1' OR client_ip ~ '^172\\.(1[6-9]|2[0-9]|3[01])\\.' THEN 'เทสบน VM Kong' "
    "WHEN client_ip = '20.44.247.33' THEN 'D365 F&O' "
    "WHEN client_ip IN ('4.144.150.30','4.144.150.42','4.144.150.51','4.144.150.52','4.144.150.54','4.144.150.57') THEN 'SIMS (App Service Sims)' "
    "WHEN client_ip IN ('20.33.118.76','10.0.0.4') THEN 'VM WebApplication (fo-gateway)' "
    "WHEN client_ip LIKE '124.120.%' OR client_ip LIKE '124.122.%' OR client_ip LIKE '87.124.104.%' "
    "OR client_ip = '171.103.89.247' THEN 'ออฟฟิศ Bevpro (เทส)' "
    "WHEN client_ip LIKE '147.92.179.%' THEN 'LINE link preview (bot)' "
    "WHEN client_ip LIKE '52.112.%' THEN 'Microsoft Teams preview (bot)' "
    "WHEN client_ip LIKE '104.47.%' OR client_ip LIKE '57.155.%' THEN 'Microsoft link scanner (bot)' "
    "ELSE 'ไม่รู้จัก — ตรวจว่าเป็น SIMS / SAP' END"
)
# Our own tests and link-preview bots — hidden when the "แสดง" variable is set to external
TEAM_OR_BOT = (
    "(client_ip = '127.0.0.1' OR client_ip ~ '^172\\.(1[6-9]|2[0-9]|3[01])\\.' "
    "OR client_ip LIKE '124.120.%' OR client_ip LIKE '124.122.%' OR client_ip LIKE '87.124.104.%' OR client_ip = '171.103.89.247' "
    "OR client_ip LIKE '147.92.179.%' OR client_ip LIKE '52.112.%' OR client_ip LIKE '104.47.%' OR client_ip LIKE '57.155.%')"
)


def caller_filter():
    # allValue '__all__' keeps the SQL valid even when the variable query returns no rows
    return "('__all__' IN ($caller) OR client_ip IN ($caller))"


def scope_filter():
    return f"('$scope' = 'all' OR NOT {TEAM_OR_BOT})"


def base_where():
    return f"route_name IN ($route) AND {caller_filter()} AND {scope_filter()} AND $__timeFilter(request_time)"


def stat(pid, title, desc, sql, x, y, w, color_steps, unit="short", no_value="0"):
    return {
        "id": pid, "type": "stat", "title": title, "description": desc, "datasource": PG,
        "gridPos": {"h": 4, "w": w, "x": x, "y": y},
        "targets": [{"refId": "A", "format": "table", "rawQuery": True, "rawSql": sql}],
        "options": {"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
                    "colorMode": "background", "graphMode": "none", "textMode": "value", "justifyMode": "center"},
        "fieldConfig": {"defaults": {"unit": unit, "noValue": no_value,
                                     "thresholds": {"mode": "absolute", "steps": color_steps}}, "overrides": []},
    }


def text(pid, title, md, x, y, w, h):
    return {"id": pid, "type": "text", "title": title, "gridPos": {"h": h, "w": w, "x": x, "y": y},
            "options": {"mode": "markdown", "content": md}}


def bars(pid, title, desc, sql, x, y, w, h, unit="short", stack=True, draw="bars"):
    return {
        "id": pid, "type": "timeseries", "title": title, "description": desc, "datasource": PG,
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "targets": [{"refId": "A", "format": "time_series", "rawQuery": True, "rawSql": sql}],
        "fieldConfig": {"defaults": {"unit": unit, "custom": {
            "drawStyle": draw, "lineWidth": 1 if draw == "bars" else 2, "fillOpacity": 80 if draw == "bars" else 10,
            "showPoints": "never" if draw == "bars" else "always", "spanNulls": False,
            "stacking": {"mode": "normal" if stack else "none", "group": "A"}}},
            "overrides": []},
        "options": {"legend": {"displayMode": "list", "placement": "bottom", "showLegend": True},
                    "tooltip": {"mode": "multi", "sort": "desc"}},
    }


def table(pid, title, desc, sql, x, y, w, h, status_col="status", wide_cols=(), type_col=None, mid_cols=()):
    overrides = []
    if type_col:  # SIMS result code from the response body: S = accepted, E = rejected
        overrides.append({"matcher": {"id": "byName", "options": type_col}, "properties": [
            {"id": "custom.cellOptions", "value": {"type": "color-background", "mode": "basic"}},
            {"id": "thresholds", "value": {"mode": "absolute", "steps": [{"color": "transparent", "value": None}]}},
            {"id": "mappings", "value": [{"type": "value", "options": {
                "S": {"text": "S สำเร็จ", "color": "green", "index": 0},
                "E": {"text": "E ไม่รับ", "color": "red", "index": 1}}}]}]})
    if status_col:
        overrides.append({"matcher": {"id": "byName", "options": status_col}, "properties": [
            {"id": "custom.cellOptions", "value": {"type": "color-background", "mode": "basic"}},
            {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                {"color": "green", "value": None}, {"color": "orange", "value": 400}, {"color": "red", "value": 500}]}}]})
    for c in wide_cols:
        overrides.append({"matcher": {"id": "byName", "options": c}, "properties": [
            {"id": "custom.width", "value": 900}, {"id": "custom.inspect", "value": True}]})
    for c in mid_cols:
        overrides.append({"matcher": {"id": "byName", "options": c}, "properties": [
            {"id": "custom.width", "value": 450}, {"id": "custom.inspect", "value": True}]})
    return {
        "id": pid, "type": "table", "title": title, "description": desc, "datasource": PG,
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "targets": [{"refId": "A", "format": "table", "rawQuery": True, "rawSql": sql}],
        "fieldConfig": {"defaults": {"custom": {"align": "auto", "filterable": True, "inspect": True}},
                        "overrides": overrides},
        "options": {"showHeader": True, "footer": {"show": False}, "cellHeight": "sm"},
    }


def variables(route_options, caller_routes, default=None):
    default = default or route_options
    route_var = {
        "name": "route", "label": "Kong route", "type": "custom", "multi": True, "includeAll": False,
        "query": ",".join(route_options),
        "current": {"selected": True, "text": default, "value": default},
        "options": [{"selected": r in default, "text": r, "value": r} for r in route_options],
    }
    in_list = ",".join(f"'{r}'" for r in caller_routes)
    caller_var = {
        "name": "caller", "label": "ผู้เรียก (IP)", "type": "query", "datasource": PG,
        "query": f"SELECT DISTINCT client_ip FROM kong_api_logs WHERE route_name IN ({in_list}) "
                 f"AND $__timeFilter(request_time) ORDER BY 1",
        "refresh": 2, "multi": True, "includeAll": True, "allValue": "'__all__'",
        "current": {"selected": True, "text": ["All"], "value": ["$__all"]}, "sort": 1,
    }
    scope_var = {
        "name": "scope", "label": "แสดง", "type": "custom", "multi": False, "includeAll": False,
        "query": "ทั้งหมด : all,เฉพาะภายนอก (ซ่อนทีมเราและ bot) : external",
        "current": {"selected": True, "text": "ทั้งหมด", "value": "all"},
        "options": [{"selected": True, "text": "ทั้งหมด", "value": "all"},
                    {"selected": False, "text": "เฉพาะภายนอก (ซ่อนทีมเราและ bot)", "value": "external"}],
    }
    return {"list": [scope_var, route_var, caller_var]}


def dashboard(uid, title, tags, panels, templ, desc):
    return {
        "uid": uid, "title": title, "description": desc, "tags": tags, "timezone": "browser",
        "schemaVersion": 39, "version": 1, "refresh": "15m", "time": {"from": "now-7d", "to": "now"},
        "editable": True, "graphTooltip": 1, "templating": templ, "panels": panels,
        "links": [{"title": "SAP → SIMS" if uid == "kong-sims-to-sap" else "SIMS → SAP", "type": "link",
                   "url": "/grafana/d/" + ("kong-sap-to-sims" if uid == "kong-sims-to-sap" else "kong-sims-to-sap"),
                   "icon": "dashboard", "keepTime": True}],
    }


QUERIES = {}


def reg(name, panel):
    for t in panel.get("targets", []):
        QUERIES[name + "/" + panel["title"]] = t["rawSql"]
    return panel


GREEN = [{"color": "text", "value": None}, {"color": "green", "value": 1}]
RED = [{"color": "text", "value": None}, {"color": "red", "value": 1}]
ORANGE = [{"color": "text", "value": None}, {"color": "orange", "value": 1}]
NEUTRAL = [{"color": "blue", "value": None}]

# ===================================================== SIMS -> SAP
W = base_where()
CAT_OUT = ("CASE WHEN status_code < 400 THEN 'สำเร็จ' "
           "WHEN status_code = 401 THEN 'SAP ไม่รับรหัส (401)' "
           "WHEN status_code = 403 THEN 'Kong บล็อก (403)' "
           "WHEN status_code >= 500 OR status_code = 499 THEN 'SAP / เครือข่ายล่ม (5xx)' "
           "ELSE 'อื่นๆ (4xx)' END")
# What SAP answered (response_body, captured since 2026-10-07): SOAP faultstring, else the text of the HTML error page
SAP_SAYS = ("CASE WHEN response_body IS NULL THEN '-' "
            "WHEN response_body ~* '<(\\w+:)?faultstring' "
            "THEN substring(response_body from '(?i)<(?:\\w+:)?faultstring[^>]*>([^<]*)<') "
            "ELSE left(trim(regexp_replace(regexp_replace(regexp_replace(response_body, '<style.*</style>', '', 'is'), "
            "'<[^>]+>', ' ', 'g'), '(\\s|&nbsp;?)+', ' ', 'g')), 120) END")
# request_headers / response_headers (jsonb, captured since 2026-10-14 by log-receiver, interface routes only)
# shown one "name: value" per line as sent, except authorization = "Basic user=... pass_len=... b64_len=..." (no password).
# Older rows are NULL; rows before the auth_info deploy show authorization as [REDACTED].
def HDRS(col):
    return f"(SELECT string_agg(key || ': ' || value, E'\\n' ORDER BY key) FROM jsonb_each_text({col}))"


# sap-pi-soap (/sap-pi) deleted 2026-10-07 and dropped from the filter 2026-10-08 —
# its 103 rows (2026-09-29..10-07) stay in kong_api_logs: query route_name = 'sap-pi-soap' directly
SAP_ROUTES = ["sap-pi-uat-soap", "sap-pi-prod-soap"]
# Tables also show calls Kong could not route (404 "no Route matched", route_name NULL): wrong method (routes accept
# GET/POST/HEAD only), the deleted /sap-pi path, or a missing prefix. Stats/charts keep W (matched routes only).
W_ALL_OUT = (f"(route_name IN ($route) OR (route_name IS NULL AND (path LIKE '/sap-pi%' OR path LIKE '%XISOAPAdapter%'))) "
             f"AND {caller_filter()} AND {scope_filter()} AND $__timeFilter(request_time)")
ROUTE_OR_404 = "coalesce(route_name, '(ไม่ตรง route — 404)')"
n = "sims-to-sap"
out_panels = [
    text(1, "", (
        "### ขาไป: **SIMS → Kong → SAP PI**\n"
        "UAT: `/sap-pi-uat` (`sap-pi-uat-soap`) → **qbx** = SAP QAS · "
        "Prod: `/sap-pi-prod` (`sap-pi-prod-soap`) → **pbx** = SAP PRD (allow เฉพาะ IP ของ SIMS Prod) · "
        "เลือก route ด้านบนเพื่อดูแยก environment · `sap-pi-soap` = `/sap-pi` เดิม (ลบแล้ว 07/10 เหลือไว้ดูประวัติ)  \n"
        "username/password ของ SAP ผู้เรียกส่งมาเอง Kong แค่ส่งต่อ · ตาราง **ผู้เรียก** ด้านล่างบอกว่าใครยิงมา "
        "(IP ที่ขึ้นว่า *ไม่รู้จัก* = ตรวจว่าเป็น SIMS แล้วเพิ่มชื่อใน dashboard)"), 0, 0, 24, 4),
    reg(n, stat(2, "ทั้งหมด", "จำนวน call ที่วิ่งผ่าน Kong ไป SAP ในช่วงเวลาที่เลือก",
                f"SELECT count(*) AS v FROM kong_api_logs WHERE {W}", 0, 4, 4, NEUTRAL)),
    reg(n, stat(3, "✅ สำเร็จ", "SAP ตอบ status ต่ำกว่า 400 = รับข้อมูลแล้ว",
                f"SELECT count(*) AS v FROM kong_api_logs WHERE {W} AND status_code < 400", 4, 4, 4, GREEN)),
    reg(n, stat(4, "🔑 SAP ไม่รับรหัส (401)", "ถึง SAP แล้ว แต่ username/password ผิด หรือ user ถูกล็อก — แก้ที่รหัส ไม่ใช่ network",
                f"SELECT count(*) AS v FROM kong_api_logs WHERE {W} AND status_code = 401", 8, 4, 4, ORANGE)),
    reg(n, stat(5, "🚫 Kong บล็อก (403)", "ไม่ถึง SAP — IP ผู้เรียกไม่อยู่ใน allow list ของ route นั้น (prod เปิดเฉพาะ IP ของ SIMS Prod)",
                f"SELECT count(*) AS v FROM kong_api_logs WHERE {W} AND status_code = 403", 12, 4, 4, ORANGE)),
    reg(n, stat(6, "⚠️ SAP / เครือข่ายล่ม (5xx)", "502/503/504 = Kong ไปไม่ถึง SAP หรือ SAP ล่ม · 499 = ผู้เรียกตัดสายก่อนได้คำตอบ",
                f"SELECT count(*) AS v FROM kong_api_logs WHERE {W} AND (status_code >= 500 OR status_code = 499)", 16, 4, 4, RED)),
    reg(n, stat(7, "สำเร็จล่าสุด", "เวลาที่ SAP รับข้อมูลสำเร็จครั้งล่าสุด (ในช่วงเวลาที่เลือก)",
                f"SELECT (extract(epoch FROM max(request_time)) * 1000)::bigint AS v FROM kong_api_logs WHERE {W} AND status_code < 400",
                20, 4, 4, NEUTRAL, unit="dateTimeFromNow", no_value="ยังไม่เคยสำเร็จ")),
    reg(n, bars(8, "จำนวน call แยกตามผล", "ทุกแท่ง = จำนวน call ในช่วงนั้น แยกสีตามผลลัพธ์",
                f"SELECT $__timeGroupAlias(request_time,$__interval), {CAT_OUT} AS metric, count(*) AS calls "
                f"FROM kong_api_logs WHERE {W} GROUP BY 1, 2 ORDER BY 1", 0, 8, 15, 8)),
    reg(n, bars(9, "เวลาตอบ (ms)", "latency รวมที่ผู้เรียกเห็น = เวลา SAP + Kong · เฉลี่ย และ สูงสุด ต่อช่วง",
                f"SELECT $__timeGroupAlias(request_time,$__interval), avg(latency_ms) AS \"เฉลี่ย\", max(latency_ms) AS \"สูงสุด\" "
                f"FROM kong_api_logs WHERE {W} GROUP BY 1 ORDER BY 1", 15, 8, 9, 8, unit="ms", stack=False, draw="points")),
    reg(n, table(10, "ผู้เรียก — ใครยิงมาบ้าง (ทุก method)", "แยกตาม IP ต้นทาง · รวม request ที่ Kong ตอบ 404 เพราะไม่ตรง route (ผิด method / ผิด path) · ไว้ดูว่า SIMS เริ่มยิงจริงหรือยัง",
                 f"SELECT {CALLER} AS \"ผู้เรียก\", client_ip AS \"IP\", string_agg(DISTINCT method, ',') AS \"method\", count(*) AS \"ครั้ง\", "
                 f"count(*) FILTER (WHERE status_code < 400) AS \"สำเร็จ\", "
                 f"count(*) FILTER (WHERE status_code = 401) AS \"401 รหัสผิด\", "
                 f"count(*) FILTER (WHERE status_code = 403) AS \"403 Kong บล็อก\", "
                 f"count(*) FILTER (WHERE route_name IS NULL) AS \"404 ไม่ตรง route\", "
                 f"count(*) FILTER (WHERE status_code >= 500 OR status_code = 499) AS \"5xx\", "
                 f"max(request_time) AS \"ล่าสุด\" "
                 f"FROM kong_api_logs WHERE {W_ALL_OUT} GROUP BY 1, 2 ORDER BY \"ล่าสุด\" DESC", 0, 16, 24, 7, status_col=None)),
    reg(n, table(11, "Call ล่าสุด 200 รายการ (ทุก method)", "interface = ชื่อ interface ของ SAP PI จาก query string · SOAP = element แรกใน Body · route = (ไม่ตรง route — 404) คือ Kong ตอบเองเพราะผิด method หรือผิด path ไม่ถึง SAP",
                 f"SELECT request_time AS \"เวลา\", {ROUTE_OR_404} AS \"route\", {CALLER} AS \"ผู้เรียก\", client_ip AS \"IP\", method AS \"method\", "
                 f"left(split_part(path, '?', 1), 60) AS \"path\", "
                 f"coalesce(substring(path from 'interface=([^&]+)'), '-') AS \"interface\", "
                 f"coalesce(substring(request_body from '<(?:[A-Za-z0-9_]+:)?Body[^>]*>\\s*<(?:[A-Za-z0-9_]+:)?([A-Za-z0-9_]+)'), '-') AS \"SOAP\", "
                 f"status_code AS \"status\", {SAP_SAYS} AS \"SAP ตอบ\", "
                 f"latency_ms AS \"ms\", request_size AS \"ส่งไป (byte)\", response_size AS \"ได้กลับ (byte)\", "
                 f"request_id AS \"request_id\" "
                 f"FROM kong_api_logs WHERE {W_ALL_OUT} ORDER BY request_time DESC LIMIT 200", 0, 23, 24, 11)),
    reg(n, table(12, "ข้อมูลที่ส่งไป และที่ SAP ตอบกลับ 50 รายการล่าสุด (ทุก method)",
                 "request body = เนื้อ SOAP ที่ผู้เรียกส่ง · response body = สิ่งที่ SAP ตอบ (SOAP fault / หน้า error บอกสาเหตุ) "
                 "· request headers = header ที่ผู้เรียกส่งมา (Content-Type, SOAPAction, Host) · authorization = ใครยิง: user=ชื่อบัญชี pass_len=ความยาวรหัส (ไม่เก็บตัวรหัส) "
                 "· response headers = header ขากลับ (Server = ใครตอบ, X-Kong-Upstream-Latency มีค่า = ถึง SAP แล้ว, WWW-Authenticate) "
                 "· request ที่ไม่ตรง route (404) ไม่มี response จาก SAP · เก็บ response ตั้งแต่ 2026-10-07 15:50 · header ตั้งแต่ 2026-10-14 "
                 "· Kong เก็บไม่เกิน 64 KB ล้างทิ้งเมื่อเกิน 30 วัน · กดที่ช่อง (Inspect value) เพื่อดูเต็ม",
                 f"SELECT request_time AS \"เวลา\", {CALLER} AS \"ผู้เรียก\", client_ip AS \"IP\", method AS \"method\", {ROUTE_OR_404} AS \"route\", "
                 f"status_code AS \"status\", {SAP_SAYS} AS \"SAP ตอบ\", "
                 f"{HDRS('request_headers')} AS \"request headers\", request_body AS \"request body\", "
                 f"{HDRS('response_headers')} AS \"response headers\", response_body AS \"response body\" "
                 f"FROM kong_api_logs WHERE {W_ALL_OUT} "
                 f"ORDER BY request_time DESC LIMIT 50",
                 0, 34, 24, 9, wide_cols=("request body", "response body"),
                 mid_cols=("request headers", "response headers"))),
    text(13, "อ่านผลยังไง", (
        "| status | ความหมาย | แก้ที่ |\n|---|---|---|\n"
        "| **2xx** | SAP รับข้อมูลแล้ว | — |\n"
        "| **401** | ถึง SAP แล้ว แต่ username/password ไม่ผ่าน หรือ user ถูกล็อก | ขอรหัสที่ถูกจาก Thai Namthip — **อย่าลองซ้ำหลายครั้ง** user อาจโดนล็อก |\n"
        "| **403** | Kong ไม่ปล่อยผ่าน: IP ไม่อยู่ใน allow list ของ route นั้น | UAT: `fix-my-ip.ps1 -IncludeKong` · Prod: `SIMS_PROD_IPS=... add-sap-pi-env-routes.sh` |\n"
        "| **404** | path / interface ผิด | ตรวจ URL และ query string |\n"
        "| **502/503/504** | Kong ไปไม่ถึง SAP หรือ SAP ล่ม | ตรวจกับ Thai Namthip |\n"
        "| **499** | ผู้เรียกตัดสายก่อนได้คำตอบ (timeout ฝั่งผู้เรียก) | เพิ่ม timeout ผู้เรียก |"), 0, 43, 24, 7),
]
dash_out = dashboard("kong-sims-to-sap", "SIMS → SAP (ขาไป ผ่าน Kong)", ["kong", "sims", "sap", "integration"],
                     out_panels, variables(SAP_ROUTES, SAP_ROUTES, default=["sap-pi-uat-soap"]),
                     "SIMS ส่งข้อมูลเข้า SAP PI ผ่าน Kong route /sap-pi")

# ===================================================== SAP -> SIMS
# SIMS answers HTTP 200 even when it rejects the order; the real result is <TYPE> (S/E) + <MESSAGE> in the response.
# response_body is captured since 2026-10-07 — older rows have NULL and are judged by status only (as before).
RTYPE = "substring(response_body from '<TYPE[^>]*>([^<]*)</TYPE>')"
RMSG = "substring(response_body from '<MESSAGE[^>]*>([^<]*)</MESSAGE>')"
ACCEPTED = f"status_code < 400 AND coalesce({RTYPE}, 'S') <> 'E'"
REJECTED_E = f"status_code < 400 AND {RTYPE} = 'E'"
CAT_IN = (f"CASE WHEN {REJECTED_E} THEN 'SIMS ไม่รับใบงาน (200 + TYPE=E)' "
          "WHEN status_code < 400 THEN 'สำเร็จ' "
          "WHEN status_code IN (401, 403) THEN 'ไม่ผ่านการยืนยันตัว (401/403)' "
          "WHEN status_code = 404 THEN 'SIMS ไม่รู้จัก path / รูปแบบ (404)' "
          "WHEN status_code >= 500 OR status_code = 499 THEN 'SIMS error (5xx)' "
          "ELSE 'SIMS ปฏิเสธข้อมูล (4xx)' END")
n = "sap-to-sims"
# Tables also show non-POST calls (GET from browsers, wrong method) to the SAP path: route sims-uat-sap-service-orders
# accepts POST only, so those fall to the catch-all route sims-uat-all. Stats/charts keep W (POST route = real SAP sends).
W_ALL = (f"(route_name IN ($route) OR (route_name = 'sims-uat-all' AND path LIKE '/sims-uat/api/v1/integrations/sap/%') "
         f"OR (route_name IS NULL AND path LIKE '%/integrations/sap/%')) "
         f"AND {caller_filter()} AND {scope_filter()} AND $__timeFilter(request_time)")
# SAP PI sends tags with or without a namespace prefix (<ORDERID> before, <ns2:ORDERID> since 2026-10-19).
NS = "(?:[A-Za-z0-9_]+:)?"
def TAG_RE(tag):
    return f"<{NS}{tag}(?:\\s[^>]*)?>([^<]+)</{NS}{tag}>"
# The work order is the ORDERID right after <HEADER ...>; later ORDERIDs belong to HISTORYORDER (older orders).
ORDERID = (f"coalesce(substring(request_body from '<{NS}HEADER(?:\\s[^>]*)?>\\s*<{NS}ORDERID>([^<]+)<'), "
           f"substring(request_body from '{TAG_RE('ORDERID')}'))")
NOTIF = f"substring(request_body from '{TAG_RE('NOTIF_NO')}')"
# 1 work order = 1 HEADER block (ORDERID repeats in sub-sections and history, so do not count ORDERID).
# Count the closing tag: the opening tag carries a namespace (<HEADER xmlns="urn:microsoft-dynamics-nav/xmlports/x50003">).
N_ORDERS = f"regexp_count(request_body, '</{NS}HEADER>')"
def X(tag):
    return f"coalesce(substring(request_body from '{TAG_RE(tag)}'), '-')"

in_panels = [
    text(1, "", (
        "### ขากลับ: **SAP PI → Kong → SIMS** · รับได้ทั้ง **http** และ **https** (POST, SOAP XML) — เข้า SIMS เหมือนกัน\n"
        "**http** (TNT ใช้อยู่ตอนนี้ · ไม่เข้ารหัส): `http://bevprogateway.southeastasia.cloudapp.azure.com/sims-uat/api/v1/integrations/sap/service-orders`  \n"
        "**https**: `https://bevprogateway.southeastasia.cloudapp.azure.com/sims-uat/api/v1/integrations/sap/service-orders`  \n"
        "Kong route `sims-uat-sap-service-orders` → SIMS UAT `bevpro-sims-uat.azurewebsites.net` (https) "
        "· Kong ไม่ตรวจ auth / ไม่จำกัด IP — **SIMS ตรวจ Basic auth เอง** · ผู้เรียก *ไม่รู้จัก* = ตรวจว่าเป็น SAP PI"),
        0, 0, 24, 4),
    reg(n, stat(2, "ทั้งหมด", "จำนวนครั้งที่มีการส่งข้อมูลเข้า SIMS ผ่าน Kong",
                f"SELECT count(*) AS v FROM kong_api_logs WHERE {W}", 0, 4, 4, NEUTRAL)),
    reg(n, stat(3, "✅ SIMS รับแล้ว", "SIMS ตอบ status ต่ำกว่า 400 และ TYPE ไม่ใช่ E (call ก่อน 2026-10-07 15:50 ไม่มี response — นับจาก status อย่างเดียว)",
                f"SELECT count(*) AS v FROM kong_api_logs WHERE {W} AND {ACCEPTED}", 4, 4, 4, GREEN)),
    reg(n, stat(4, "📦 ใบงานที่ส่งเข้ามา", "จำนวนใบงาน (<HEADER>) ในข้อความที่ SIMS รับสำเร็จ (นับจาก body ที่ Kong เก็บ ≤ 64 KB)",
                f"SELECT coalesce(sum({N_ORDERS}), 0) AS v FROM kong_api_logs WHERE {W} AND {ACCEPTED} AND request_body IS NOT NULL",
                8, 4, 4, NEUTRAL)),
    reg(n, stat(5, "SIMS ปฏิเสธ (4xx / TYPE=E)", "SIMS ไม่รับข้อมูล: 4xx (รูปแบบผิด / path ผิด / ไม่ผ่านการยืนยันตัว) หรือตอบ 200 แต่ TYPE=E — ดู MESSAGE ในตาราง",
                f"SELECT count(*) AS v FROM kong_api_logs WHERE {W} AND ((status_code >= 400 AND status_code < 500 AND status_code <> 499) OR {REJECTED_E})",
                12, 4, 4, ORANGE)),
    reg(n, stat(6, "⚠️ SIMS error (5xx)", "SIMS พังระหว่างประมวลผล หรือ Kong ไปไม่ถึง SIMS",
                f"SELECT count(*) AS v FROM kong_api_logs WHERE {W} AND (status_code >= 500 OR status_code = 499)", 16, 4, 4, RED)),
    reg(n, stat(7, "รับสำเร็จล่าสุด", "เวลาที่ SIMS รับข้อมูลสำเร็จครั้งล่าสุด (ในช่วงเวลาที่เลือก)",
                f"SELECT (extract(epoch FROM max(request_time)) * 1000)::bigint AS v FROM kong_api_logs WHERE {W} AND {ACCEPTED}",
                20, 4, 4, NEUTRAL, unit="dateTimeFromNow", no_value="ยังไม่เคยสำเร็จ")),
    reg(n, bars(8, "จำนวน call แยกตามผล", "ทุกแท่ง = จำนวน call ในช่วงนั้น แยกสีตามผลลัพธ์",
                f"SELECT $__timeGroupAlias(request_time,$__interval), {CAT_IN} AS metric, count(*) AS calls "
                f"FROM kong_api_logs WHERE {W} GROUP BY 1, 2 ORDER BY 1", 0, 8, 15, 8)),
    reg(n, bars(9, "เวลาที่ SIMS ใช้ประมวลผล (ms)", "latency รวม = เวลา SIMS + Kong · เฉลี่ย และ สูงสุด ต่อช่วง",
                f"SELECT $__timeGroupAlias(request_time,$__interval), avg(latency_ms) AS \"เฉลี่ย\", max(latency_ms) AS \"สูงสุด\" "
                f"FROM kong_api_logs WHERE {W} GROUP BY 1 ORDER BY 1", 15, 8, 9, 8, unit="ms", stack=False, draw="points")),
    reg(n, table(10, "ผู้เรียก — ใครเข้ามาที่ path SAP บ้าง (ทุก method)", "แยกตาม IP ต้นทาง · รวม GET จาก browser (ได้ 404 เป็นปกติ — endpoint รับเฉพาะ POST) · ไว้ดูว่า SAP PI เริ่มส่งจริงหรือยัง",
                 f"SELECT {CALLER} AS \"ผู้เรียก\", client_ip AS \"IP\", string_agg(DISTINCT method, ',') AS \"method\", count(*) AS \"ครั้ง\", "
                 f"count(*) FILTER (WHERE status_code < 400) AS \"สำเร็จ\", "
                 f"count(*) FILTER (WHERE status_code >= 400 AND status_code < 500) AS \"4xx\", "
                 f"count(*) FILTER (WHERE status_code >= 500) AS \"5xx\", "
                 f"max(left(user_agent, 40)) AS \"user agent\", max(request_time) AS \"ล่าสุด\" "
                 f"FROM kong_api_logs WHERE {W_ALL} GROUP BY 1, 2 ORDER BY \"ล่าสุด\" DESC", 0, 16, 24, 7, status_col=None)),
    reg(n, table(11, "Call ที่เข้า path SAP ล่าสุด 200 รายการ (ทุก method)", "POST = ข้อมูลใบงานจาก SAP · GET/อื่นๆ = มีคนเปิดลิงก์หรือเรียกผิด method (ได้ 404) · รายละเอียดจากใบงานแรกในข้อความ · ใบงาน = จำนวน <HEADER> ในข้อความ · ไม่แสดงเบอร์โทร/เลขบัตรประชาชน (ดูได้ใน request body ด้านล่าง)",
                 f"SELECT request_time AS \"เวลา\", {CALLER} AS \"ผู้เรียก\", client_ip AS \"IP\", method AS \"method\", "
                 f"{ROUTE_OR_404} AS \"route\", "
                 f"coalesce(substring(request_body from '<(?:[A-Za-z0-9_]+:)?Body[^>]*>\\s*<(?:[A-Za-z0-9_]+:)?([A-Za-z0-9_]+)'), '-') AS \"SOAP\", "
                 f"coalesce({ORDERID}, '-') AS \"ORDERID\", coalesce({NOTIF}, '-') AS \"NOTIF_NO\", "
                 f"{X('ORDER_TYPE')} AS \"ORDER_TYPE\", {X('AUARTTEXT')} AS \"ประเภทงาน\", {X('SHORT_TEXT')} AS \"รายละเอียดงาน\", "
                 f"{X('CUSTOMER')} AS \"รหัสลูกค้า\", {X('CUST_NAME')} AS \"ชื่อลูกค้า\", {X('CITY1')} AS \"จังหวัด\", "
                 f"{X('EQ_MODEL')} AS \"รุ่นเครื่อง\", {X('NOTIF_CODE_TEXT')} AS \"ประเภทแจ้ง\", "
                 f"CASE WHEN request_body IS NULL THEN NULL ELSE {N_ORDERS} END AS \"ใบงาน\", "
                 f"status_code AS \"status\", {RTYPE} AS \"TYPE\", {RMSG} AS \"MESSAGE\", "
                 f"latency_ms AS \"ms\", request_size AS \"ส่งเข้า (byte)\", response_size AS \"SIMS ตอบ (byte)\", "
                 f"request_id AS \"request_id\" "
                 f"FROM kong_api_logs WHERE {W_ALL} ORDER BY request_time DESC LIMIT 200", 0, 23, 24, 11, type_col="TYPE")),
    reg(n, table(12, "ข้อมูลที่เข้ามา และที่ SIMS ตอบกลับ 50 รายการล่าสุด (ทุก method)",
                 "request body = เนื้อ SOAP ที่ส่งเข้า SIMS · response body = ผลที่ SIMS ตอบ (TYPE S = รับ / E = ไม่รับ + MESSAGE) "
                 "· GET ไม่มี body (ไม่ได้ส่งข้อมูล) · response ของ GET ที่ตกไป route sims-uat-all ไม่ถูกเก็บ "
                 "· request headers = header ที่ SAP PI ส่งมา (Content-Type, SOAPAction, User-Agent) · authorization = ใครยิง: user=ชื่อบัญชี pass_len=ความยาวรหัส "
                 "(ไม่เก็บตัวรหัส · pass_len น้อยกว่ารหัสจริง + มี header ชื่อแปลกไม่มีค่า = SAP ตัด base64 ทุก 76 ตัว รหัสไปไม่ครบ) "
                 "· response headers = header ที่ SIMS ตอบ (Server: Kestrel = SIMS ตอบเอง, X-Kong-Upstream-Latency มีค่า = ถึง SIMS แล้ว) "
                 "· เก็บ response ตั้งแต่ 2026-10-07 15:50 · header ตั้งแต่ 2026-10-14 · Kong เก็บไม่เกิน 64 KB ล้างทิ้งเมื่อเกิน 30 วัน "
                 "· กดที่ช่อง (Inspect value) เพื่อดูเต็ม",
                 f"SELECT request_time AS \"เวลา\", {CALLER} AS \"ผู้เรียก\", client_ip AS \"IP\", method AS \"method\", {ROUTE_OR_404} AS \"route\", "
                 f"left(split_part(path, '?', 1), 60) AS \"path\", status_code AS \"status\", "
                 f"coalesce({ORDERID}, '-') AS \"ORDERID\", "
                 f"{RTYPE} AS \"TYPE\", {RMSG} AS \"MESSAGE\", "
                 f"{HDRS('request_headers')} AS \"request headers\", request_body AS \"request body\", "
                 f"{HDRS('response_headers')} AS \"response headers\", response_body AS \"response body\" "
                 f"FROM kong_api_logs WHERE {W_ALL} "
                 f"ORDER BY request_time DESC LIMIT 50",
                 0, 34, 24, 9, wide_cols=("request body", "response body"), type_col="TYPE",
                 mid_cols=("request headers", "response headers"))),
    text(13, "อ่านผลยังไง", (
        "| status | ความหมาย | แก้ที่ |\n|---|---|---|\n"
        "| **200 + TYPE=S** | SIMS รับใบงานแล้ว | — |\n"
        "| **200 + TYPE=E** | SIMS อ่านได้แต่ไม่รับใบงาน (เช่น ไม่มี HEADER / ข้อมูลไม่ครบ) | ดู MESSAGE ในตาราง |\n"
        "| **400** | SIMS อ่านข้อมูลไม่ได้ / ข้อมูลไม่ครบ | ดู body ในตารางด้านบน เทียบ spec |\n"
        "| **401/403** | ไม่ผ่านการยืนยันตัว | ตรวจ credential ที่ SAP ส่ง |\n"
        "| **404** | path ผิด หรือส่งรูปแบบที่ SIMS ไม่รับ (เช่นส่ง JSON แทน SOAP XML) | ตรวจ URL / Content-Type |\n"
        "| **5xx** | SIMS พังระหว่างประมวลผล หรือ Kong ไปไม่ถึง SIMS | ดู log ของ SIMS ด้วย request_id |"), 0, 43, 24, 7),
]
dash_in = dashboard("kong-sap-to-sims", "SAP → SIMS (ขากลับ ผ่าน Kong)", ["kong", "sims", "sap", "integration"],
                    in_panels, variables(["sims-uat-sap-service-orders"], ["sims-uat-sap-service-orders"]),
                    "SAP PI ส่งใบงานเข้า SIMS ผ่าน Kong route /sims-uat/api/v1/integrations/sap/service-orders")

for name, d in [("kong-sims-to-sap.json", dash_out), ("kong-sap-to-sims.json", dash_in)]:
    with open(os.path.join(OUT_DIR, name), "w", encoding="utf-8", newline="\n") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")
with open(QUERIES_OUT, "w", encoding="utf-8") as f:
    json.dump(QUERIES, f, ensure_ascii=False, indent=1)
print("written", len(out_panels), "+", len(in_panels), "panels;", len(QUERIES), "queries")
