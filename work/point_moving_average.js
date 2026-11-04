// Average existing chart samples, not calendar days or resampled daily data.
function pointMovingAverage(points, windowSize = 1) {
  if (![1, 7, 30].includes(windowSize)) throw new Error("Unsupported moving-average window");
  return points.map(([date, value], index) => {
    if (windowSize === 1) return [date, Number.isFinite(value) ? value : null];
    if (index < windowSize - 1) return [date, null];
    let sum = 0;
    for (let offset = 0; offset < windowSize; offset++) {
      const sample = points[index - offset][1];
      if (!Number.isFinite(sample)) return [date, null];
      sum += sample;
    }
    return [date, sum / windowSize];
  });
}

function movingAverageScript() {
  return pointMovingAverage.toString();
}

function movingAverageControls(prefix) {
  return `<div class="average-controls" id="${prefix}AverageModes" role="group" aria-label="曲线显示方式">
    <span class="average-label">曲线</span>
    <button type="button" class="metric-tab active" data-average="1" aria-pressed="true">原数据</button>
    <button type="button" class="metric-tab" data-average="7" aria-pressed="false">7点均线</button>
    <button type="button" class="metric-tab" data-average="30" aria-pressed="false">30点均线</button>
  </div>`;
}

function movingAverageCss(scope) {
  return `
    #${scope} .average-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; padding: 9px 15px 0; }
    #${scope} .average-controls[hidden] { display: none; }
    #${scope} .average-label { color: #8fa5bf; font-size: 12px; margin-right: 3px; }
    #${scope} .average-controls button { padding: 5px 9px; font-size: 12px; }
    #${scope} .average-controls button:focus-visible { outline: 2px solid #f5c96a; outline-offset: 3px; }
  `.trim();
}

module.exports = { pointMovingAverage, movingAverageScript, movingAverageControls, movingAverageCss };
