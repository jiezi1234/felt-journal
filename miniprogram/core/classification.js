// Unknown/old backends and low-confidence predictions are valid save paths.
const automaticCategories = ['饮食', '自然', '出行', '日常'];
function fields(result) {
  const accepted = result && result.status === 'classified' && automaticCategories.includes(result.category)
    && typeof result.confidence === 'number' && Number.isFinite(result.confidence) && result.confidence >= .65 && result.confidence <= 1;
  return accepted ? { category: result.category, categorySource: 'auto' } : { category: '未分类', categorySource: 'none' };
}
module.exports = { fields };
