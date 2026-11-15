function lastByWeek(rows) {
  const weeks = new Map();
  for (const row of rows) {
    const monday = new Date(row.date + "T00:00:00Z");
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const key = monday.toISOString().slice(0, 10);
    if (!weeks.has(key) || row.date > weeks.get(key).date) weeks.set(key, row);
  }
  return [...weeks.values()].sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { lastByWeek };
