function learn(host) {
  host.guideLearned = true;
  host.setData({ showBoardGuide: false });
}
function reset(host) { clearTimeout(host.saveFeedbackTimer); host.setData({ layoutSaved: false }); }
function saved(host) {
  clearTimeout(host.saveFeedbackTimer); host.feedbackBoard = host.date;
  host.setData({ layoutSaved: true });
  host.saveFeedbackTimer = setTimeout(() => { if (!host.disposed) host.setData({ layoutSaved: false }); }, 1800);
}
module.exports = { learn, reset, saved };
