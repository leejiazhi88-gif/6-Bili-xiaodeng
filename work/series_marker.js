// Shared legend marker for the retail, large-money and official scope controls.
function seriesMarkerCss(selector) {
  return `
    ${selector} { position: relative; display: inline-block; width: 22px; height: 12px; flex: none; }
    ${selector}::before { content: ""; position: absolute; left: 0; right: 0; top: 50%;
      border-top: 2px solid var(--series-color); transform: translateY(-50%); }
    ${selector}::after { content: ""; position: absolute; left: 50%; top: 50%;
      width: 8px; height: 8px; box-sizing: border-box; border: 2px solid #eaf4f2;
      border-radius: 50%; background: var(--series-color); transform: translate(-50%, -50%); }
  `.trim();
}
module.exports = { seriesMarkerCss };
