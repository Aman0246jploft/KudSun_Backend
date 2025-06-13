// models/ModulePermission.js
const mongoose = require('mongoose');

const modulePermissionSchema = new mongoose.Schema({
    role: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', required: true },
    module: { type: mongoose.Schema.Types.ObjectId, ref: 'Module', required: true },
    permissions: {
        create: { type: Boolean, default: false },
        read: { type: Boolean, default: false },
        update: { type: Boolean, default: false },
        delete: { type: Boolean, default: false }
    }
});

modulePermissionSchema.options.toJSON = {
    transform: function (doc, ret, options) {
        delete ret.__v;
        return ret;
    }
};

module.exports = mongoose.model("ModulePermission", modulePermissionSchema, "ModulePermission");
