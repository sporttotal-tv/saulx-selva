#include <assert.h>
#include <stdalign.h>
#include <string.h>
#include "redismodule.h"
#include "errors.h"
#include "tree.h"
#include "selva_onload.h"
#include "cdefs.h"

#define SELVA_OBJECT_ENCODING_VERSION  0

enum SelvaObjectType {
    SELVA_OBJECT_NULL,
    SELVA_OBJECT_STRING,
    SELVA_OBJECT_DOUBLE,
    SELVA_OBJECT_OBJECT,
};

RB_HEAD(SelvaObjectKeys, SelvaObjectKey);

struct SelvaObjectKey {
    RB_ENTRY(SelvaObjectKey) _entry;
    enum SelvaObjectType type;
    void *value;
    size_t name_len;
    char name[0];
};

struct SelvaObject {
    struct SelvaObjectKeys keys_head;
};

RB_PROTOTYPE_STATIC(SelvaObjectKeys, SelvaObjectKey, _entry, SelvaObject_Compare)

static int SelvaObject_Compare(struct SelvaObjectKey *a, struct SelvaObjectKey *b) {
    return strcmp(a->name, b->name);
}

static RedisModuleType *ObjectType;

RB_GENERATE_STATIC(SelvaObjectKeys, SelvaObjectKey, _entry, SelvaObject_Compare)

static struct SelvaObject *new_selva_object(void) {
    struct SelvaObject *obj;

    obj = RedisModule_Alloc(sizeof(*obj));
    RB_INIT(&obj->keys_head);

    return obj;
}

void destroy_selva_object(struct SelvaObject *obj) {
    /* TODO Clear the RB tree */

    RedisModule_Free(obj);
}

static struct SelvaObject *SelvaObject_Open(RedisModuleCtx *ctx, RedisModuleString *key_name, int mode) {
    struct SelvaObject *obj = NULL;
    RedisModuleKey *key;
    int type;

    key = RedisModule_OpenKey(ctx, key_name, mode);
    type = RedisModule_KeyType(key);

    if (type != REDISMODULE_KEYTYPE_EMPTY &&
        RedisModule_ModuleTypeGetType(key) != ObjectType) {
        RedisModule_CloseKey(key);
        RedisModule_ReplyWithError(ctx, REDISMODULE_ERRORMSG_WRONGTYPE);

        return NULL;
    }

    /* Create an empty value object if the key is currently empty. */
    if (type == REDISMODULE_KEYTYPE_EMPTY) {
        if ((mode & REDISMODULE_WRITE) == REDISMODULE_WRITE) {
            obj = new_selva_object();
            if (!obj) {
                replyWithSelvaError(ctx, SELVA_ENOMEM);
            }

            RedisModule_ModuleTypeSetValue(key, ObjectType, obj);
        } else {
            replyWithSelvaError(ctx, SELVA_ENOENT);
        }
    } else {
        obj = RedisModule_ModuleTypeGetValue(key);
        if (!obj) {
            replyWithSelvaError(ctx, SELVA_ENOENT);
        }
    }

    return obj;
}

int SelvaObject_Key2Obj(RedisModuleKey *key, struct SelvaObject **out) {
    struct SelvaObject *obj;

    /* Create an empty value object if the key is currently empty. */
    if (RedisModule_KeyType(key) == REDISMODULE_KEYTYPE_EMPTY) {
        int err;

        obj = new_selva_object();
        if (!obj) {
            return SELVA_ENOMEM;
        }

        err = RedisModule_ModuleTypeSetValue(key, ObjectType, obj);
        if (err != REDISMODULE_OK) {
            destroy_selva_object(obj);
            return SELVA_ENOENT;
        }
        /* TODO This check is really slow */
#if 0
    } else if (RedisModule_ModuleTypeGetType(key) == ObjectType) {
#endif
    } else {
        obj = RedisModule_ModuleTypeGetValue(key);
        if (!obj) {
            fprintf(stderr, "Invalid type\n"); /* FIXME Remove */
            return SELVA_ENOENT;
        }
#if 0
    } else {
        return SELVA_EINVAL;
#endif
    }

    *out = obj;
    return 0;
}

static struct SelvaObjectKey *get_key(struct SelvaObject *obj, const RedisModuleString *key_name, int create) {
    struct SelvaObjectKey *filter;
    struct SelvaObjectKey *key;
    TO_STR(key_name);
    const size_t key_size = sizeof(struct SelvaObjectKey) + key_name_len + 1;
    char buf[key_size] __attribute__((aligned(alignof(struct SelvaObjectKey)))); /* RFE This might be dumb */

    filter = (struct SelvaObjectKey *)buf;
    memset(filter, 0, key_size);
    memcpy(filter->name, key_name_str, key_name_len + 1);
    filter->name_len = key_name_len;

    key = RB_FIND(SelvaObjectKeys, &obj->keys_head, filter);
    if (!key && create) {
        key = RedisModule_Alloc(key_size);
        if (!key) {
            return NULL;
        }
        memcpy(key, filter, key_size);
        memset(&key->_entry, 0, sizeof(key->_entry)); /* RFE Might not be necessary. */
        (void)RB_INSERT(SelvaObjectKeys, &obj->keys_head, key);
    }

    return key;
}

int SelvaObject_Exists(struct SelvaObject *obj, const RedisModuleString *key_name) {
    struct SelvaObjectKey *key;

    key = get_key(obj, key_name, 0);
    if (!key) {
        return SELVA_ENOENT;
    }

    return 0;
}

int SelvaObject_GetStr(struct SelvaObject *obj, const RedisModuleString *key_name, RedisModuleString **out) {
    struct SelvaObjectKey *key;

    assert(obj);

    key = get_key(obj, key_name, 0);
    if (!key) {
        return SELVA_ENOENT;
    }

    *out = key->value;

    return 0;
}

int SelvaObject_SetStr(struct SelvaObject *obj, const RedisModuleString *key_name, RedisModuleString *value) {
    struct SelvaObjectKey *key;

    assert(obj);

    key = get_key(obj, key_name, 1);
    if (!key) {
        return SELVA_ENOMEM;
    }

    switch (key->type) {
    /* TODO Other types */
    case SELVA_OBJECT_NULL:
        /* NOP */
        break;
    case SELVA_OBJECT_STRING:
        RedisModule_Free(key->value);
        break;
    default:
        fprintf(stderr, "%s: Unknown object value type (%d)\n", __FILE__, (int)key->type);
    }

    RedisModule_RetainString(NULL, value);
    key->type = SELVA_OBJECT_STRING;
    key->value = value;

    return 0;
}

int SelvaObject_GetCommand(RedisModuleCtx *ctx, RedisModuleString **argv, int argc) {
    RedisModule_AutoMemory(ctx);
    struct SelvaObject *obj;
    RedisModuleString *value;
    int err;

    const size_t ARGV_KEY = 1;
    const size_t ARGV_OKEY = 2;

    if (argc < 3) {
        return RedisModule_WrongArity(ctx);
    }

    obj = SelvaObject_Open(ctx, argv[ARGV_KEY], REDISMODULE_READ);
    if (!obj) {
        return replyWithSelvaError(ctx, SELVA_ENOENT);
    }

    err = SelvaObject_GetStr(obj, argv[ARGV_OKEY], &value);
    if (err == SELVA_ENOENT) {
        return RedisModule_ReplyWithNull(ctx);
    } else if (err) {
        return replyWithSelvaError(ctx, err);
    }
    RedisModule_ReplyWithString(ctx, value);

    return REDISMODULE_OK;
}

int SelvaObject_GetAllCommand(RedisModuleCtx *ctx, RedisModuleString **argv, int argc) {
    RedisModule_AutoMemory(ctx);
    struct SelvaObject *obj;

    const size_t ARGV_KEY = 1;

    if (argc < 2) {
        return RedisModule_WrongArity(ctx);
    }

    obj = SelvaObject_Open(ctx, argv[ARGV_KEY], REDISMODULE_READ | REDISMODULE_WRITE);
    if (!obj) {
        return replyWithSelvaError(ctx, SELVA_ENOENT);
    }

    struct SelvaObjectKey *key;
    size_t n = 0;

    RedisModule_ReplyWithArray(ctx, REDISMODULE_POSTPONED_ARRAY_LEN);
    RB_FOREACH(key, SelvaObjectKeys, &obj->keys_head) {
        RedisModule_ReplyWithArray(ctx, 2);
        RedisModule_ReplyWithStringBuffer(ctx, key->name, key->name_len);

        switch (key->type) {
        case SELVA_OBJECT_NULL:
            RedisModule_ReplyWithNull(ctx);
            break;
        case SELVA_OBJECT_STRING:
            RedisModule_ReplyWithString(ctx, key->value);
            break;
        default:
            RedisModule_ReplyWithError(ctx, "type error");
        }

        n++;
    }
    RedisModule_ReplySetArrayLength(ctx, n);

    return REDISMODULE_OK;
}

int SelvaObject_SetCommand(RedisModuleCtx *ctx, RedisModuleString **argv, int argc) {
    RedisModule_AutoMemory(ctx);
    struct SelvaObject *obj;
    int err;

    const size_t ARGV_KEY = 1;
    const size_t ARGV_OKEY = 2;
    const size_t ARGV_TYPE = 3;
    const size_t ARGV_OVAL = 4;

    if (argc < 5) {
        return RedisModule_WrongArity(ctx);
    }

    obj = SelvaObject_Open(ctx, argv[ARGV_KEY], REDISMODULE_READ | REDISMODULE_WRITE);
    if (!obj) {
        return replyWithSelvaError(ctx, SELVA_ENOENT);
    }

    /* TODO parse type & set by type */

    err = SelvaObject_SetStr(obj, argv[ARGV_OKEY], argv[ARGV_OVAL]);
    if (err) {
        return replyWithSelvaError(ctx, err);
    }
    RedisModule_ReplyWithStringBuffer(ctx, "OK", 2);

    return REDISMODULE_OK;
}

void *SelvaObjectTypeRDBLoad(RedisModuleIO *io, int encver) {
    struct SelvaObject *obj;

    if (encver != SELVA_OBJECT_ENCODING_VERSION) {
        /*
         * RFE
         * We should actually log an error here, or try to implement
         * the ability to load older versions of our data structure.
         */
        return NULL;
    }

    obj = new_selva_object();
    if (!obj) {
        /* FIXME error handling */
    }

    int done = 0;
    while (!done) {
        RedisModuleString *name;
        name = RedisModule_LoadString(io);

        enum SelvaObjectType type;
        type = RedisModule_LoadUnsigned(io);

        switch (type) {
        case SELVA_OBJECT_NULL:
            done = 1;
            break;
        case SELVA_OBJECT_STRING:
            {
                RedisModuleString *value;
                value = RedisModule_LoadString(io);

                /* TODO Error handling */
                SelvaObject_SetStr(obj, name, value);
                RedisModule_FreeString(NULL, value);
            }
            break;
        default:
            RedisModule_LogIOError(io, "warning", "Unknown type");
        }

        RedisModule_FreeString(NULL, name);
    }

    return obj;
}

void SelvaObjectTypeRDBSave(RedisModuleIO *io, void *value) {
    struct SelvaObject *obj = (struct SelvaObject *)value;
    struct SelvaObjectKey *key;

    RB_FOREACH(key, SelvaObjectKeys, &obj->keys_head) {
        RedisModule_SaveStringBuffer(io, key->name, key->name_len);

        /* TODO Other types */
        if (key->type != SELVA_OBJECT_NULL) {
            if (!key->value) {
                RedisModule_LogIOError(io, "warning", "Value is NULL");
                continue;
            }

            switch (key->type) {
            case SELVA_OBJECT_STRING:
                RedisModule_SaveUnsigned(io, key->type);
                RedisModule_SaveString(io, key->value);
                break;
            default:
                RedisModule_LogIOError(io, "warning", "Unknown type");
            }
        }
    }

    const char term[] = "___selva$terminator";
    RedisModule_SaveStringBuffer(io, term, sizeof(term) - 1);   /* key name */
    RedisModule_SaveUnsigned(io, SELVA_OBJECT_NULL);            /* key type */
    /* nil                                                         value    */
}

void SelvaObjectTypeFree(void *value) {
    struct SelvaObject *obj = (struct SelvaObject *)value;

    destroy_selva_object(obj);
}

static int SelvaObject_OnLoad(RedisModuleCtx *ctx) {
    RedisModuleTypeMethods tm = {
        .version = REDISMODULE_TYPE_METHOD_VERSION,
        .rdb_load = SelvaObjectTypeRDBLoad,
        .rdb_save = SelvaObjectTypeRDBSave,
#if 0
        .aof_rewrite = SelvaObjectTypeAOFRewrite,
#endif
        .free = SelvaObjectTypeFree,
    };

    ObjectType = RedisModule_CreateDataType(ctx, "selva_obj", SELVA_OBJECT_ENCODING_VERSION, &tm);
    if (ObjectType == NULL) {
        return REDISMODULE_ERR;
    }

    /*
     * Register commands.
     */
    if (
#if 0
        RedisModule_CreateCommand(ctx, "selva.object.del", SelvaObject_DelCommand, "write", 1, 1, 1) == REDISMODULE_ERR ||
        RedisModule_CreateCommand(ctx, "selva.object.exists", SelvaObject_ExistsCommand, "readonly", 1, 1, 1) == REDISMODULE_ERR ||
#endif
        RedisModule_CreateCommand(ctx, "selva.object.get", SelvaObject_GetCommand, "readonly", 1, 1, 1) == REDISMODULE_ERR ||
        RedisModule_CreateCommand(ctx, "selva.object.getall", SelvaObject_GetAllCommand, "readonly", 1, 1, 1) == REDISMODULE_ERR ||
#if 0
        RedisModule_CreateCommand(ctx, "selva.object.getrange", SelvaObject_GetRangeCommand, "readonly", 1, 1, 1) == REDISMODULE_ERR ||
        RedisModule_CreateCommand(ctx, "selva.object.incrby", SelvaObject_IncrbyCommand, "write", 1, 1, 1) == REDISMODULE_ERR ||
        RedisModule_CreateCommand(ctx, "selva.object.incrbydouble", SelvaObject_IncrbyDoubleCommand, "write", 1, 1, 1) == REDISMODULE_ERR ||
        RedisModule_CreateCommand(ctx, "selva.object.keys", SelvaObject_KeysCommand, "readonly", 1, 1, 1) == REDISMODULE_ERR ||
        RedisModule_CreateCommand(ctx, "selva.object.len", SelvaObject_LenCommand, "readonly", 1, 1, 1) == REDISMODULE_ERR ||
        RedisModule_CreateCommand(ctx, "selva.object.mget", SelvaObject_MgetCommand, "readonly", 1, 1, 1) == REDISMODULE_ERR ||
        RedisModule_CreateCommand(ctx, "selva.object.mset", SelvaObject_MsetCommand, "write deny-oom", 1, 1, 1) == REDISMODULE_ERR ||
        RedisModule_CreateCommand(ctx, "selva.object.scan", SelvaObject_ScanCommand, "readonly", 1, 1, 1) == REDISMODULE_ERR ||
#endif
        RedisModule_CreateCommand(ctx, "selva.object.set", SelvaObject_SetCommand, "write deny-oom", 1, 1, 1) == REDISMODULE_ERR
#if 0
        RedisModule_CreateCommand(ctx, "selva.object.setnx", SelvaObject_SetNXCommand, "write deny-oom", 1, 1, 1) == REDISMODULE_ERR ||
        RedisModule_CreateCommand(ctx, "selva.object.strlen", SelvaObject_StrlenCommand, "readonly", 1, 1, 1) == REDISMODULE_ERR ||
#endif
        /*RedisModule_CreateCommand(ctx, "selva.object.vals", SelvaObject_ValsCommand, "readonly", 1, 1, 1) == REDISMODULE_ERR*/) {
        return REDISMODULE_ERR;
    }

    return REDISMODULE_OK;
}
SELVA_ONLOAD(SelvaObject_OnLoad);
