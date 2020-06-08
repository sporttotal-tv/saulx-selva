#include <punit.h>
#include <stdlib.h>
#include <string.h>
#include "hierarchy.h"
#include "cdefs.h"

SelvaModify_Hierarchy *hierarchy;
Selva_NodeId *findRes;

static int SelvaNodeId_Compare(const void *a, const void *b) {

    return strncmp((const char *)a, (const char *)b, SELVA_NODE_ID_SIZE);
}

static void SelvaNodeId_SortRes(size_t len) {
    qsort(findRes, len, sizeof(Selva_NodeId), SelvaNodeId_Compare);
}

static char *SelvaNodeId_GetRes(size_t i) {
    static char id[sizeof(Selva_NodeId) + 1];

    memcpy(id, findRes[i], sizeof(Selva_NodeId));
    id[sizeof(Selva_NodeId)] = '\0';

    return id;
}

static void setup(void)
{
    hierarchy = SelvaModify_NewHierarchy();
}

static void teardown(void)
{
    SelvaModify_DestroyHierarchy(hierarchy);
    hierarchy = NULL;

    free(findRes);
    findRes = NULL;
}

static char * test_insert_one(void)
{
    const Selva_NodeId id = "abc1";
    const int res = SelvaModify_SetHierarchy(hierarchy, id, 0, NULL, 0, NULL);

    pu_assert_equal("a node was inserted", res, 0);

    return NULL;
}

static char * test_insert_many(void)
{
    const Selva_NodeId ids[] = { "a", "b", "c", "d", "e", "f" };

    for (size_t i = 0; i < num_elem(ids); i++) {
        const int res = SelvaModify_SetHierarchy(hierarchy, ids[i], 0, NULL, 0, NULL);
        pu_assert_equal("a node was inserted", res, 0);
    }

    return NULL;
}

static char * test_insert_chain_find_ancestors(void)
{
    const Selva_NodeId ids[] = { "a", "b", "c", "d", "e", "f" };

    SelvaModify_SetHierarchy(hierarchy, ids[0], 0, NULL, 0, NULL);
    for (size_t i = 1; i < num_elem(ids); i++) {
        Selva_NodeId parents[1];

        memcpy(parents[0], ids[i - 1], sizeof(Selva_NodeId));
        SelvaModify_SetHierarchy(hierarchy, ids[i], num_elem(parents), parents, 0, NULL);
    }

    const int nr_ancestors = SelvaModify_FindAncestors(hierarchy, ((Selva_NodeId){ "d" }), &findRes);

    pu_assert_equal("returned the right number of ancestors", nr_ancestors, 3);
    pu_assert("results pointer was set", findRes != NULL);

    for (size_t i = 0; i < nr_ancestors; i++) {
        pu_assert("the returned ancestor ID is one of the real ancestors", strstr("abc", SelvaNodeId_GetRes(i)));
    }

    return NULL;
}

static char * test_insert_acyclic_find_ancestors_1(void)
{
    /*
     *  a -> b --> c
     *   \-->--/
     */

    SelvaModify_SetHierarchy(hierarchy, "grphnode_a", 0, NULL, 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_b", 1, ((Selva_NodeId []){ "grphnode_a" }), 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_c", 1, ((Selva_NodeId []){ "grphnode_b", "grphnode_a" }), 0, NULL);

    const int nr_ancestors = SelvaModify_FindAncestors(hierarchy, ((Selva_NodeId){ "grphnode_c" }), &findRes);

    pu_assert_equal("returned the right number of ancestors", nr_ancestors, 2);
    pu_assert("results pointer was set", findRes != NULL);

    SelvaNodeId_SortRes(nr_ancestors);
    pu_assert_str_equal("c has b as an ancestor", SelvaNodeId_GetRes(0), "grphnode_a");
    pu_assert_str_equal("c has a as an ancestor", SelvaNodeId_GetRes(1), "grphnode_b");

    return NULL;
}

static char * test_insert_acyclic_find_ancestors_2(void)
{
    /*
     *  a --> b ---> d --> e
     *   \--->c-->/
     */

    int nr_ancestors;

    SelvaModify_SetHierarchy(hierarchy, "grphnode_a", 0, NULL, 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_b", 1, ((Selva_NodeId []){ "grphnode_a" }), 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_c", 1, ((Selva_NodeId []){ "grphnode_a" }), 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_d", 2,((Selva_NodeId []){ "grphnode_b", "grphnode_c" }), 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_e", 1, ((Selva_NodeId []){ "grphnode_d" }), 0, NULL);

    /* ancestors of c */
    nr_ancestors = SelvaModify_FindAncestors(hierarchy, ((Selva_NodeId){ "grphnode_c" }), &findRes);
    pu_assert_equal("returned the right number of ancestors", nr_ancestors, 1);
    pu_assert("results pointer was set", findRes != NULL);
    pu_assert_str_equal("c has b as an ancestor", SelvaNodeId_GetRes(0), "grphnode_a");

    /* ancestors of e */
    nr_ancestors = SelvaModify_FindAncestors(hierarchy, ((Selva_NodeId){ "grphnode_e" }), &findRes);
    pu_assert_equal("returned the right number of ancestors", nr_ancestors, 4);
    pu_assert("results pointer was set", findRes != NULL);
    SelvaNodeId_SortRes(nr_ancestors);
    pu_assert_str_equal("e has d as an ancestor", SelvaNodeId_GetRes(3), "grphnode_d");
    pu_assert_str_equal("e has c as an ancestor", SelvaNodeId_GetRes(2), "grphnode_c");
    pu_assert_str_equal("e has b as an ancestor", SelvaNodeId_GetRes(1), "grphnode_b");
    pu_assert_str_equal("e has a as an ancestor", SelvaNodeId_GetRes(0), "grphnode_a");

    return NULL;
}

static char * test_insert_acyclic_find_ancestors_3(void)
{
    /*
     *  e --> a --> c
     *           /
     *        b --> d
     */

    int nr_ancestors;

    SelvaModify_SetHierarchy(hierarchy, "grphnode_a", 0, NULL, 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_b", 0, NULL, 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_c", 2, ((Selva_NodeId []){ "grphnode_a", "grphnode_b" }), 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_d", 1, ((Selva_NodeId []){ "grphnode_b" }), 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_e", 0, NULL, 1, ((Selva_NodeId []){ "grphnode_a" }));

    /* ancestors of d */
    nr_ancestors = SelvaModify_FindAncestors(hierarchy, ((Selva_NodeId){ "grphnode_d" }), &findRes);
    SelvaNodeId_SortRes(nr_ancestors);
    pu_assert_equal("returned the right number of ancestors", nr_ancestors, 1);
    pu_assert("results pointer was set", findRes != NULL);
    pu_assert_str_equal("d has b as an ancestor", SelvaNodeId_GetRes(0), "grphnode_b");

    /* ancestors of c */
    nr_ancestors = SelvaModify_FindAncestors(hierarchy, ((Selva_NodeId){ "grphnode_c" }), &findRes);
    SelvaNodeId_SortRes(nr_ancestors);
    pu_assert_equal("returned the right number of ancestors", nr_ancestors, 3);
    pu_assert("results pointer was set", findRes != NULL);
    pu_assert_str_equal("c has a as an ancestor", SelvaNodeId_GetRes(0), "grphnode_a");
    pu_assert_str_equal("c has b as an ancestor", SelvaNodeId_GetRes(1), "grphnode_b");
    pu_assert_str_equal("c has e as an ancestor", SelvaNodeId_GetRes(2), "grphnode_e");

    return NULL;
}

static char * test_insert_acyclic_find_descendants_1(void)
{
    /*
     *  a -> b --> c
     *   \-->--/
     */

    SelvaModify_SetHierarchy(hierarchy, "grphnode_a", 0, NULL, 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_b", 1, ((Selva_NodeId []){ "grphnode_a" }), 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_c", 1, ((Selva_NodeId []){ "grphnode_b", "grphnode_a" }), 0, NULL);

    const int nr_descendants = SelvaModify_FindDescendants(hierarchy, ((Selva_NodeId){ "grphnode_a" }), &findRes);

    pu_assert_equal("returned the right number of descendants", nr_descendants, 2);
    pu_assert("results pointer was set", findRes != NULL);

    SelvaNodeId_SortRes(nr_descendants);
    pu_assert_str_equal("a has b as a descendant", SelvaNodeId_GetRes(0), "grphnode_b");
    pu_assert_str_equal("a has c as a descendant", SelvaNodeId_GetRes(1), "grphnode_c");

    return NULL;
}

static char * test_insert_acyclic_find_descendants_2(void)
{
    /*
     *  a --> b ---> d --> e
     *   \--->c-->/
     */

    int nr_descendants;

    SelvaModify_SetHierarchy(hierarchy, "grphnode_a", 0, NULL, 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_b", 1, ((Selva_NodeId []){ "grphnode_a" }), 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_c", 1, ((Selva_NodeId []){ "grphnode_a" }), 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_d", 2,((Selva_NodeId []){ "grphnode_b", "grphnode_c" }), 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_e", 1, ((Selva_NodeId []){ "grphnode_d" }), 0, NULL);

    /* descendants of c */
    nr_descendants = SelvaModify_FindDescendants(hierarchy, ((Selva_NodeId){ "grphnode_c" }), &findRes);
    pu_assert_equal("returned the right number of descendants", nr_descendants, 2);
    pu_assert("results pointer was set", findRes != NULL);
    pu_assert_str_equal("b has d as an ancestor", SelvaNodeId_GetRes(0), "grphnode_d");
    pu_assert_str_equal("b has e as an ancestor", SelvaNodeId_GetRes(1), "grphnode_e");

    /* ancestors of a */
    nr_descendants = SelvaModify_FindDescendants(hierarchy, ((Selva_NodeId){ "grphnode_a" }), &findRes);
    pu_assert_equal("returned the right number of descendants", nr_descendants, 4);
    pu_assert("results pointer was set", findRes != NULL);
    SelvaNodeId_SortRes(nr_descendants);
    pu_assert_str_equal("a has b as an ancestor", SelvaNodeId_GetRes(0), "grphnode_b");
    pu_assert_str_equal("a has c as an ancestor", SelvaNodeId_GetRes(1), "grphnode_c");
    pu_assert_str_equal("a has d as an ancestor", SelvaNodeId_GetRes(2), "grphnode_d");
    pu_assert_str_equal("a has e as an ancestor", SelvaNodeId_GetRes(3), "grphnode_e");

    /* ancestors of b */
    nr_descendants = SelvaModify_FindDescendants(hierarchy, ((Selva_NodeId){ "grphnode_b" }), &findRes);
    pu_assert_equal("returned the right number of descendants", nr_descendants, 2);
    pu_assert("results pointer was set", findRes != NULL);
    SelvaNodeId_SortRes(nr_descendants);
    pu_assert_str_equal("b has d as a descendant", SelvaNodeId_GetRes(0), "grphnode_d");
    pu_assert_str_equal("b has e as a descendant", SelvaNodeId_GetRes(1), "grphnode_e");

    return NULL;
}

static char * test_insert_acyclic_find_descendants_3(void)
{
    /*
     *  e --> a --> c
     *           /
     *        b --> d
     */

    int nr_descendants;

    SelvaModify_SetHierarchy(hierarchy, "grphnode_a", 0, NULL, 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_b", 0, NULL, 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_c", 2, ((Selva_NodeId []){ "grphnode_a", "grphnode_b" }), 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_d", 1, ((Selva_NodeId []){ "grphnode_b" }), 0, NULL);
    SelvaModify_SetHierarchy(hierarchy, "grphnode_e", 0, NULL, 1, ((Selva_NodeId []){ "grphnode_a" }));

    /* descendants of e */
    nr_descendants = SelvaModify_FindDescendants(hierarchy, ((Selva_NodeId){ "grphnode_e" }), &findRes);
    SelvaNodeId_SortRes(nr_descendants);
    pu_assert_equal("returned the right number of descendants", nr_descendants, 2);
    pu_assert("results pointer was set", findRes != NULL);
    pu_assert_str_equal("e has a as a descendant", SelvaNodeId_GetRes(0), "grphnode_a");
    pu_assert_str_equal("e has c as a descendant", SelvaNodeId_GetRes(1), "grphnode_c");

    /* ancestors of b */
    nr_descendants = SelvaModify_FindDescendants(hierarchy, ((Selva_NodeId){ "grphnode_b" }), &findRes);
    SelvaNodeId_SortRes(nr_descendants);
    pu_assert_equal("returned the right number of descendants", nr_descendants, 2);
    pu_assert("results pointer was set", findRes != NULL);
    pu_assert_str_equal("b has c as a descendant", SelvaNodeId_GetRes(0), "grphnode_c");
    pu_assert_str_equal("b has d as a descendant", SelvaNodeId_GetRes(1), "grphnode_d");

    return NULL;
}

void all_tests(void)
{
    pu_def_test(test_insert_one, PU_RUN);
    pu_def_test(test_insert_many, PU_RUN);
    pu_def_test(test_insert_chain_find_ancestors, PU_RUN);
    pu_def_test(test_insert_acyclic_find_ancestors_1, PU_RUN);
    pu_def_test(test_insert_acyclic_find_ancestors_2, PU_RUN);
    pu_def_test(test_insert_acyclic_find_ancestors_3, PU_RUN);
    pu_def_test(test_insert_acyclic_find_descendants_1, PU_RUN);
    pu_def_test(test_insert_acyclic_find_descendants_2, PU_RUN);
    pu_def_test(test_insert_acyclic_find_descendants_3, PU_RUN);
}