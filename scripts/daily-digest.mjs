import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO_EMAIL = process.env.DIGEST_TO_EMAIL || 'philip.fuentes93@gmail.com';
const TABLERO_ID = 'principal';
const PANEL_URL = 'https://philipfuentes93-ops.github.io/C-digo-de-panel-de-operaciones./';

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

/* Misma lógica de vencimientos que usa el panel (index.html: función dueInfo) */
const DAY = 86400000;
const sod = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const pd = s => (s ? new Date(s + 'T12:00') : null);

function dueClass(t, now) {
  if (t.status === 'finalizado') return 'done';
  if (!t.date) return 'later';
  const days = Math.round((sod(pd(t.date)) - sod(now)) / DAY);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 3) return 'soon';
  return 'later';
}

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function rowHtml(t, area) {
  return `<tr>
    <td style="padding:8px;border-bottom:1px solid #eee">${esc(t.title)}</td>
    <td style="padding:8px;border-bottom:1px solid #eee">${esc(t.client)}</td>
    <td style="padding:8px;border-bottom:1px solid #eee">${esc(t.person)}</td>
    <td style="padding:8px;border-bottom:1px solid #eee">${esc(area)}</td>
    <td style="padding:8px;border-bottom:1px solid #eee">${esc(t.date)}</td>
  </tr>`;
}

function sectionHtml(title, color, items) {
  if (!items.length) return '';
  const rows = items.map(({ t, area }) => rowHtml(t, area)).join('');
  return `
    <h2 style="color:${color};font-family:sans-serif;font-size:16px;margin:24px 0 8px">${title} (${items.length})</h2>
    <table style="width:100%;border-collapse:collapse;font-family:sans-serif;font-size:13px">
      <thead><tr style="background:#f5f5f5;text-align:left">
        <th style="padding:8px">Demanda</th><th style="padding:8px">Cliente</th><th style="padding:8px">Responsable</th><th style="padding:8px">Área</th><th style="padding:8px">Fecha</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function main() {
  const snap = await db.collection('tableros').doc(TABLERO_ID).get();
  if (!snap.exists) {
    console.log('No hay datos en tableros/' + TABLERO_ID);
    return;
  }
  const data = JSON.parse(snap.data().json || '{"groups":[]}');
  const now = new Date();

  const overdue = [], today = [], soon = [];
  (data.groups || []).forEach(g => {
    (g.tasks || []).forEach(t => {
      const cls = dueClass(t, now);
      const entry = { t, area: g.name };
      if (cls === 'overdue') overdue.push(entry);
      else if (cls === 'today') today.push(entry);
      else if (cls === 'soon') soon.push(entry);
    });
  });
  overdue.sort((a, b) => (a.t.date || '').localeCompare(b.t.date || ''));

  const totalPend = overdue.length + today.length + soon.length;
  const fecha = now.toLocaleDateString('es-CL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const body = totalPend
    ? [
        sectionHtml('⚠️ Vencidas', '#B7233C', overdue),
        sectionHtml('⏰ Vencen hoy', '#B26A00', today),
        sectionHtml('◷ Próximos 3 días', '#2A63B5', soon)
      ].join('')
    : `<p style="font-family:sans-serif;font-size:14px">No hay demandas vencidas, que venzan hoy, ni en los próximos 3 días. Todo al día ✅</p>`;

  const html = `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto">
      <h1 style="font-size:20px">Panel de Operaciones — Resumen diario</h1>
      <p style="color:#666;text-transform:capitalize">${esc(fecha)}</p>
      ${body}
      <p style="margin-top:24px;color:#999;font-size:12px">Correo generado automáticamente todos los días. <a href="${PANEL_URL}">Abrir el panel</a></p>
    </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'onboarding@resend.dev',
      to: TO_EMAIL,
      subject: totalPend ? `Panel de Operaciones: ${totalPend} demanda(s) requieren atención` : 'Panel de Operaciones: todo al día ✅',
      html
    })
  });

  if (!res.ok) {
    throw new Error(`Resend error ${res.status}: ${await res.text()}`);
  }
  console.log('Email enviado correctamente a', TO_EMAIL);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
