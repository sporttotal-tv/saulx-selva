#pragma once
#ifndef _SELVA_
#define _SELVA_

#include <stddef.h>
#include <stdint.h>

#define SELVA_NODE_ID_SIZE      10ul
#define SELVA_NODE_TYPE_SIZE    2
#define ROOT_NODE_ID            "root\0\0\0\0\0\0"

/**
 * Type for Selva NodeId.
 */
typedef char Selva_NodeId[SELVA_NODE_ID_SIZE];

#define SELVA_SUBSCRIPTION_ID_SIZE 32
#define SELVA_SUBSCRIPTION_ID_STR_LEN (2 * SELVA_SUBSCRIPTION_ID_SIZE)

/**
 * Type for Selva subscription IDs.
 * SHA256 in binary.
 */
typedef unsigned char Selva_SubscriptionId[SELVA_SUBSCRIPTION_ID_SIZE];

typedef int32_t Selva_SubscriptionMarkerId;

/**
 * Hierarchy traversal order.
 * Recognized by SelvaModify_TraverseHierarchy().
 */
enum SelvaModify_HierarchyTraversal {
    SELVA_HIERARCHY_TRAVERSAL_NONE, /*!< Do nothing. */
    SELVA_HIERARCHY_TRAVERSAL_NODE, /*!< Visit just the given node. */
    SELVA_HIERARCHY_TRAVERSAL_CHILDREN, /*!< Visit children of the given node. */
    SELVA_HIERARCHY_TRAVERSAL_PARENTS, /*!< Visit parents of the given node. */
    SELVA_HIERARCHY_TRAVERSAL_BFS_ANCESTORS,
    SELVA_HIERARCHY_TRAVERSAL_BFS_DESCENDANTS,
    SELVA_HIERARCHY_TRAVERSAL_DFS_ANCESTORS,
    SELVA_HIERARCHY_TRAVERSAL_DFS_DESCENDANTS,
    SELVA_HIERARCHY_TRAVERSAL_DFS_FULL,
    SELVA_HIERARCHY_TRAVERSAL_REF, /*!< Visit nodes pointed by a ref field. */
};

size_t Selva_NodeIdLen(Selva_NodeId nodeId);

#endif /* _SELVA_ */