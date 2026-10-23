/**
 * Cloudflare Pages Function: /api/data
 * Backing Store: Cloudflare KV Namespace bound as `GANTT_KV`
 */

const KV_KEY = 'GANTT_CLOUD_STORE_V1';
const DEFAULT_ADMIN_PIN = '123456';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Pin'
    }
  });
}

export async function onRequestOptions() {
  return jsonResponse({ ok: true });
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.GANTT_KV) {
    return jsonResponse({
      ok: false,
      kvBound: false,
      error: 'GANTT_KV namespace is not bound yet. Please bind GANTT_KV in Cloudflare Pages -> Settings -> Functions.'
    }, 200);
  }

  try {
    const raw = await env.GANTT_KV.get(KV_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return jsonResponse({
      ok: true,
      kvBound: true,
      data: data || null
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const payload = await request.json();
    const action = payload.action;

    // Resolve configured Admin PIN from env.ADMIN_PIN, or fallback to KV store / default
    let storePin = DEFAULT_ADMIN_PIN;
    if (env.GANTT_KV) {
      try {
        const raw = await env.GANTT_KV.get(KV_KEY);
        if (raw) {
          const s = JSON.parse(raw);
          if (s && s.adminPin) storePin = s.adminPin;
        }
      } catch (e) {}
    }

    const configuredPin = String(env.ADMIN_PIN || storePin || DEFAULT_ADMIN_PIN).trim();

    // Action 0: Real-time Admin PIN verification (supports custom ADMIN_PIN env variable)
    if (action === 'verifyPin') {
      const inputPin = String(payload.adminPin || '').trim();
      const match = (inputPin === configuredPin);
      if (match) {
        return jsonResponse({ ok: true, valid: true });
      } else {
        return jsonResponse({ ok: false, valid: false, error: '管理员密码错误 / Invalid Admin PIN' }, 403);
      }
    }

    if (!env.GANTT_KV) {
      return jsonResponse({
        ok: false,
        kvBound: false,
        error: 'GANTT_KV namespace is not bound yet.'
      }, 400);
    }

    const operator = (payload.operator || '匿名成员').trim();
    const nowIso = new Date().toISOString();

    const raw = await env.GANTT_KV.get(KV_KEY);
    const store = raw ? JSON.parse(raw) : {
      catalogProducts: null,
      shippingTable: null,
      sharedProjects: [],
      auditLogs: [],
      adminPin: DEFAULT_ADMIN_PIN
    };

    if (action === 'saveProject') {
      const proj = payload.project;
      if (!proj || !proj.id) {
        return jsonResponse({ ok: false, error: 'Invalid project payload' }, 400);
      }

      const existingIdx = store.sharedProjects.findIndex(p => p.id === proj.id);
      let version = 1;
      let actionLabelZh = '新建共享排期';
      let actionLabelEn = 'Created Shared Schedule';

      if (existingIdx >= 0) {
        const prev = store.sharedProjects[existingIdx];
        version = (Number(prev.version) || 1) + 1;
        actionLabelZh = `更新排期 (v${version})`;
        actionLabelEn = `Updated Schedule (v${version})`;
        proj.revisions = Array.isArray(prev.revisions) ? prev.revisions : [];
      } else {
        proj.revisions = [];
      }

      proj.version = version;
      proj.updatedAt = nowIso;
      proj.updatedBy = operator;

      const revisionEntry = {
        revId: 'rev_' + Date.now(),
        version,
        timestamp: nowIso,
        operator,
        noteZh: payload.changeNoteZh || actionLabelZh,
        noteEn: payload.changeNoteEn || actionLabelEn,
        snapshot: JSON.parse(JSON.stringify({
          projectName: proj.projectName,
          calcMode: proj.calcMode,
          anchorDate: proj.anchorDate,
          selectedCountryId: proj.selectedCountryId,
          shippingDays: proj.shippingDays,
          travelDays: proj.travelDays,
          travelMode: proj.travelMode,
          manualOverride: proj.manualOverride,
          projectItems: proj.projectItems,
          startDateStr: proj.startDateStr,
          endDateStr: proj.endDateStr,
          totalDays: proj.totalDays
        }))
      };

      proj.revisions.unshift(revisionEntry);
      proj.revisions = proj.revisions.slice(0, 30);

      if (existingIdx >= 0) {
        store.sharedProjects[existingIdx] = proj;
      } else {
        store.sharedProjects.unshift(proj);
      }

      store.auditLogs.unshift({
        id: 'log_' + Date.now(),
        timestamp: nowIso,
        operator,
        category: 'project',
        targetName: proj.projectName,
        detailZh: `${actionLabelZh}：${proj.projectName}（${proj.startDateStr} → ${proj.endDateStr}，共 ${proj.totalDays} 天）`,
        detailEn: `${actionLabelEn}: ${proj.projectName} (${proj.startDateStr} → ${proj.endDateStr}, ${proj.totalDays}d)`
      });
      store.auditLogs = store.auditLogs.slice(0, 100);

      await env.GANTT_KV.put(KV_KEY, JSON.stringify(store));
      return jsonResponse({ ok: true, data: store });
    }

    if (action === 'deleteProject') {
      if (payload.adminPin !== configuredPin) {
        return jsonResponse({ ok: false, error: '管理员密码错误 / Invalid Admin PIN' }, 403);
      }
      const targetId = payload.projectId;
      const target = store.sharedProjects.find(p => p.id === targetId);
      store.sharedProjects = store.sharedProjects.filter(p => p.id !== targetId);
      if (target) {
        store.auditLogs.unshift({
          id: 'log_' + Date.now(),
          timestamp: nowIso,
          operator,
          category: 'admin',
          targetName: target.projectName,
          detailZh: `管理员删除排期项目：${target.projectName}`,
          detailEn: `Admin deleted project schedule: ${target.projectName}`
        });
      }
      await env.GANTT_KV.put(KV_KEY, JSON.stringify(store));
      return jsonResponse({ ok: true, data: store });
    }

    if (action === 'saveMaster') {
      if (payload.adminPin !== configuredPin) {
        return jsonResponse({ ok: false, error: '管理员密码错误 / Invalid Admin PIN' }, 403);
      }
      if (Array.isArray(payload.catalogProducts)) {
        store.catalogProducts = payload.catalogProducts;
      }
      if (Array.isArray(payload.shippingTable)) {
        store.shippingTable = payload.shippingTable;
      }
      if (payload.newAdminPin && String(payload.newAdminPin).trim().length >= 4) {
        store.adminPin = String(payload.newAdminPin).trim();
      }
      store.auditLogs.unshift({
        id: 'log_' + Date.now(),
        timestamp: nowIso,
        operator,
        category: 'admin',
        targetName: '全局基础总表',
        detailZh: payload.detailZh || '管理员更新了常规产品库与各国船期总表',
        detailEn: payload.detailEn || 'Admin updated standard product catalog & shipping master table'
      });
      store.auditLogs = store.auditLogs.slice(0, 100);

      await env.GANTT_KV.put(KV_KEY, JSON.stringify(store));
      return jsonResponse({ ok: true, data: store });
    }

    return jsonResponse({ ok: false, error: 'Unknown action: ' + action }, 400);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
}
