module.exports = function requireSubscription(req, res, next) {
  const { plan_type, subscription_status } = req.user || {};
  if (plan_type === 'free' || subscription_status !== 'active') {
    return res.status(402).json({ error: 'Active subscription required', upgrade: '/pricing' });
  }
  next();
};
