require('dotenv').config();
const { User } = require('../db');
const { roleId } = require('../utils/Role');

adminCreate = async () => {
    let data = {
        userName: "Superadmin",
        email: "superadmin@gmail.com",
        password: "123456",
        phoneNumber: "1234567890",
        profileImage: null,
        roleId: roleId.SUPER_ADMIN,
    }
    try {
        let testAdmin = new User(data);
        let res = await testAdmin.save();
        console.log("res ", res);
        process.exit(1)
    } catch (error) {
        console.log(error);
    }
}
(async () => {
    await adminCreate();
})();

                                                                            