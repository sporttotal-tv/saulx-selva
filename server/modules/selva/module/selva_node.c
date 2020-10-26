#include <stddef.h>
#include "redismodule.h"
#include "alias.h"
#include "errors.h"
#include "hierarchy.h"
#include "selva_node.h"
#include "selva_object.h"
#include "selva_set.h"

static int initialize_node(RedisModuleCtx *ctx, RedisModuleKey *key, RedisModuleString *key_name, const Selva_NodeId nodeId) {
    const int is_root = !memcmp(nodeId, ROOT_NODE_ID, SELVA_NODE_ID_SIZE);
    struct SelvaObject *obj;

    SelvaObject_Key2Obj(key, &obj); /* TODO Handle errors */

    SelvaObject_SetStr(obj, RedisModule_CreateString(ctx, "$id", 3), key_name);

    /* Set the type for root. */
    if (is_root) {
        RedisModuleString *type;

        type = RedisModule_CreateStringPrintf(ctx, "root");
        if (unlikely(!type)) {
            return SELVA_MODIFY_HIERARCHY_ENOMEM;
        }

        SelvaObject_SetStr(obj, RedisModule_CreateString(ctx, "type", 3), type);
    }

    return 0;
}

RedisModuleKey *SelvaNode_Open(RedisModuleCtx *ctx, SelvaModify_Hierarchy *hierarchy, RedisModuleString *id, const Selva_NodeId nodeId, unsigned flags) {
    int err;

    /*
     * If this is a new node we need to create a hierarchy node for it.
     *
     * There is dumb circular dependency here.
     * The modify command will call this function to open and create nodes.
     * However, also hierarchy will call this function to create the node.
     * It ended up like this because nodes and hierarchy are tied together so
     * closely.
     * In theory hierarchy will only call this function when the node already
     * exists but to be extra sure, hierarchy will never pass a pointer to the
     * hierarchy it's working on.
     */
    if (hierarchy && !SelvaModify_HierarchyNodeExists(hierarchy, nodeId)) {
        size_t nr_parents;

        if ((flags & SELVA_NODE_OPEN_CREATE_FLAG) == 0) {
            return NULL;
        }

        nr_parents = unlikely(flags & SELVA_NODE_OPEN_NO_ROOT_FLAG) ? 0 : 1;
        err = SelvaModify_SetHierarchy(ctx, hierarchy, nodeId, nr_parents, ((Selva_NodeId []){ ROOT_NODE_ID }), 0, NULL);
        if (err) {
            fprintf(stderr, "%s:%d key: %s err: %s\n",
                    __FILE__,
                    __LINE__,
                    RedisModule_StringPtrLen(id, NULL),
                    getSelvaErrorStr(err));
            return NULL;
        }
    }

    /*
     * Open the redis key.
     */
    const int open_mode = REDISMODULE_READ | ((flags & SELVA_NODE_OPEN_WRFLD_FLAG) ? REDISMODULE_WRITE : 0);
    RedisModuleKey *key = RedisModule_OpenKey(ctx, id, open_mode);
    if (!key) {
        fprintf(stderr, "%s:%d key: %s err: %s\n",
                __FILE__,
                __LINE__,
                RedisModule_StringPtrLen(id, NULL),
                getSelvaErrorStr(err));
        return NULL;
    }

    /*
     * If the key is empty at this point we assume that the hash should actually
     * exist regardless of the given flags. Either there is something wrong or
     * morelikely the caller is from hierarchy.
     */
    if ((flags & SELVA_NODE_OPEN_WRFLD_FLAG) && RedisModule_KeyType(key) == REDISMODULE_KEYTYPE_EMPTY) {
        err = initialize_node(ctx, key, id, nodeId);
        if (err) {
            fprintf(stderr, "%s: %s\n", __FILE__, getSelvaErrorStr(err));
            RedisModule_CloseKey(key);
            return NULL;
        }
    }

    return key;
}

static char *delete_selva_sets(RedisModuleCtx *ctx, RedisModuleString *id) {
    // TODO Remove sets
    return 0;
}

static void delete_node_aliases(RedisModuleCtx *ctx, RedisModuleString *id) {
    RedisModuleString *akey_name;
    RedisModuleKey *key;
    TO_STR(id);

    akey_name = RedisModule_CreateStringPrintf(ctx, "%s.aliases", id_str);
    if (unlikely(!akey_name)) {
        fprintf(stderr, "%s: OOM; Unable to remove aliases of the node: \"%s\"", __FILE__, id_str);
    }

    key = RedisModule_OpenKey(ctx, akey_name, REDISMODULE_WRITE);
    if (key) {
        RedisModuleKey *aliases_key = open_aliases_key(ctx);

        if (aliases_key) {
            delete_aliases(aliases_key, key);
            RedisModule_CloseKey(aliases_key);
        } else {
            fprintf(stderr, "%s: Unable to open aliases\n", __FILE__);
        }

        RedisModule_DeleteKey(key);
        RedisModule_CloseKey(key);
    }
}

static void delete_node_object(RedisModuleCtx *ctx, RedisModuleString *id) {
    RedisModuleKey *key;

    /*
     * We could use SelvaNode_Open() here but that would be overkill.
     */
    key = RedisModule_OpenKey(ctx, id, REDISMODULE_WRITE);
    if (key) {
        RedisModule_DeleteKey(key);
        RedisModule_CloseKey(key);
    }
}

int SelvaNode_Delete(RedisModuleCtx *ctx, RedisModuleString *id) {
    delete_selva_sets(ctx, id);
    delete_node_aliases(ctx, id);
    delete_node_object(ctx, id);

    return 0;
}

int SelvaNode_ExistField(RedisModuleCtx *ctx, RedisModuleKey *node_key, const RedisModuleString *field) {
    struct SelvaObject *obj;

    SelvaObject_Key2Obj(node_key, &obj); /* TODO Handle errors */

    return !SelvaObject_Exists(obj, field);
}

int SelvaNode_GetField(RedisModuleCtx *ctx, RedisModuleKey *node_key, const RedisModuleString *field, RedisModuleString **out) {
    int err;
    struct SelvaObject *obj;

    SelvaObject_Key2Obj(node_key, &obj); /* TODO Handle errors */
    err = SelvaObject_GetStr(obj, field, out);

    return err;
}

int SelvaNode_SetField(RedisModuleCtx *ctx, RedisModuleKey *node_key, RedisModuleString *field, RedisModuleString *value) {
    struct SelvaObject *obj;

    SelvaObject_Key2Obj(node_key, &obj); /* TODO Handle errors */
    SelvaObject_SetStr(obj, field, value);

    return 0;
}

int SelvaNode_SetFieldSetRef(RedisModuleCtx *ctx, RedisModuleKey *node_key, RedisModuleString *field, RedisModuleString *value) {
    struct SelvaObject *obj;

    SelvaObject_Key2Obj(node_key, &obj); /* TODO Handle errors */
    SelvaObject_SetSetRef(obj, field, value);

    return 0;
}

int SelvaNode_DelField(RedisModuleCtx *ctx, RedisModuleKey *node_key, RedisModuleString *field) {
    struct SelvaObject *obj;

    SelvaObject_Key2Obj(node_key, &obj); /* TODO Handle errors */
    SelvaObject_DelKey(obj, field);

    return 0;
}