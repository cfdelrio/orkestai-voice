/* Orkestai Voice — Public Campaign Widget
 * Usage:
 *   <script src="https://voice.orkestai.com.ar/api/public/widget.js"></script>
 *   <div data-campaign="worldcup-2026"></div>
 */
(function () {
  'use strict';

  var API_BASE = (function () {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || '';
      if (src.indexOf('/api/public/widget.js') !== -1) {
        return src.replace('/api/public/widget.js', '');
      }
    }
    return '';
  })();

  var SPORT_COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'];

  function pct(votes, total) {
    return total > 0 ? Math.round((votes / total) * 100) : 0;
  }

  function timeAgo(isoStr) {
    var diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
    if (diff < 60) return 'hace ' + diff + 's';
    if (diff < 3600) return 'hace ' + Math.floor(diff / 60) + 'm';
    return 'hace ' + Math.floor(diff / 3600) + 'h';
  }

  function renderWidget(el, data) {
    var campaign = data.campaign || {};
    var stats = data.stats || {};
    var questions = data.questions || [];
    var activity = data.recentActivity || [];
    var isLive = campaign.status === 'running';

    var html = '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;background:#0a0e1a;color:#fff;border-radius:12px;overflow:hidden;max-width:480px;">';

    // Hero
    html += '<div style="padding:20px 20px 12px;border-bottom:1px solid #1e2a3a;">';
    if (isLive) {
      html += '<span style="display:inline-flex;align-items:center;gap:6px;background:#dc2626;color:#fff;font-size:10px;font-weight:700;letter-spacing:.08em;padding:3px 8px;border-radius:4px;margin-bottom:10px;">';
      html += '<span style="width:6px;height:6px;background:#fff;border-radius:50%;animation:orkpulse 1s infinite;"></span>EN VIVO</span>';
    }
    html += '<h2 style="margin:0 0 4px;font-size:17px;font-weight:700;color:#f1f5f9;">' + escHtml(campaign.name || '') + '</h2>';
    if (campaign.description) {
      html += '<p style="margin:0;font-size:12px;color:#64748b;">' + escHtml(campaign.description) + '</p>';
    }
    html += '</div>';

    // Stats
    if (stats.totalCalls !== undefined) {
      html += '<div style="display:flex;gap:0;border-bottom:1px solid #1e2a3a;">';
      html += kpi(stats.totalCalls, 'Llamadas');
      html += kpi(stats.answered, 'Respuestas');
      if (stats.responseRate !== undefined) html += kpi(stats.responseRate + '%', 'Participación');
      html += '</div>';
    }

    // Questions
    questions.forEach(function (q) {
      var total = q.results.reduce(function (a, r) { return a + r.votes; }, 0);
      html += '<div style="padding:16px 20px;border-bottom:1px solid #1e2a3a;">';
      html += '<p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#94a3b8;">' + escHtml(q.title) + '</p>';
      q.results.forEach(function (r, i) {
        var p = pct(r.votes, total);
        var color = SPORT_COLORS[i % SPORT_COLORS.length];
        html += '<div style="margin-bottom:10px;">';
        html += '<div style="display:flex;justify-content:space-between;margin-bottom:5px;">';
        html += '<span style="font-size:14px;font-weight:600;color:#f1f5f9;">' + escHtml(r.label) + '</span>';
        html += '<span style="font-size:14px;font-weight:700;color:' + color + ';">' + p + '%</span>';
        html += '</div>';
        html += '<div style="background:#1e2a3a;border-radius:4px;height:8px;overflow:hidden;">';
        html += '<div style="height:100%;border-radius:4px;background:' + color + ';width:' + p + '%;transition:width 1s ease-out;"></div>';
        html += '</div>';
        html += '<p style="margin:3px 0 0;font-size:11px;color:#475569;">' + r.votes + ' votos</p>';
        html += '</div>';
      });
      html += '</div>';
    });

    // Recent activity
    if (activity.length > 0) {
      html += '<div style="padding:12px 20px;border-bottom:1px solid #1e2a3a;">';
      html += '<p style="margin:0 0 10px;font-size:11px;font-weight:600;letter-spacing:.06em;color:#475569;text-transform:uppercase;">Actividad reciente</p>';
      activity.slice(0, 5).forEach(function (a) {
        var loc = a.city ? ' desde ' + a.city : '';
        html += '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #111827;">';
        html += '<span style="font-size:16px;">⚽</span>';
        html += '<div style="flex:1;min-width:0;">';
        html += '<span style="font-size:13px;color:#cbd5e1;">' + escHtml(a.firstName) + escHtml(loc) + ' · </span>';
        html += '<span style="font-size:13px;font-weight:600;color:#f1f5f9;">' + escHtml(a.response) + '</span>';
        html += '</div>';
        html += '<span style="font-size:11px;color:#475569;white-space:nowrap;">' + timeAgo(a.createdAt) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    // Footer
    html += '<div style="padding:10px 20px;display:flex;justify-content:space-between;align-items:center;">';
    html += '<span style="font-size:11px;color:#334155;">Actualizado ' + timeAgo(campaign.updatedAt || new Date().toISOString()) + '</span>';
    html += '<a href="https://voice.orkestai.com.ar" target="_blank" style="font-size:10px;color:#475569;text-decoration:none;">Orkestai Voice</a>';
    html += '</div>';

    html += '</div>';

    // CSS animation (injected once)
    if (!document.getElementById('orkestai-widget-style')) {
      var style = document.createElement('style');
      style.id = 'orkestai-widget-style';
      style.textContent = '@keyframes orkpulse{0%,100%{opacity:1}50%{opacity:.4}}';
      document.head.appendChild(style);
    }

    el.innerHTML = html;
  }

  function kpi(value, label) {
    return '<div style="flex:1;text-align:center;padding:12px 8px;">' +
      '<div style="font-size:22px;font-weight:800;color:#f1f5f9;">' + value + '</div>' +
      '<div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;">' + label + '</div>' +
      '</div>';
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function initWidget(el) {
    var slug = el.getAttribute('data-campaign');
    if (!slug) return;

    var url = API_BASE + '/api/public/campaigns/' + encodeURIComponent(slug) + '/feed';
    var refreshMs = 10000;

    function fetch_and_render() {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.onload = function () {
        if (xhr.status === 200) {
          try {
            var data = JSON.parse(xhr.responseText);
            refreshMs = (data.config && data.config.refreshIntervalSeconds || 10) * 1000;
            renderWidget(el, data);
          } catch (e) {}
        }
      };
      xhr.send();
    }

    fetch_and_render();
    setInterval(fetch_and_render, refreshMs);
  }

  function init() {
    var els = document.querySelectorAll('[data-campaign]');
    for (var i = 0; i < els.length; i++) {
      initWidget(els[i]);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
