const { apiErrorRes } = require("../utils/globalFunction");
const HTTP_STATUS = require("../utils/statusCode");

function hasPermission(requiredRoles) {
  return async (req, res, next) => {
    const roleId = req.user.roleId;
    if (requiredRoles.includes(roleId)) {
      next();
    } else {
      return apiErrorRes(HTTP_STATUS.FORBIDDEN, res, "Forbidden!", null);
    }
  };
}


module.exports={
    hasPermission
}