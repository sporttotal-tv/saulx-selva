#include <assert.h>
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "cdefs.h"
#include "redismodule.h"
#include "hierarchy.h"
#include "rpn.h"

/* TODO Handle NULL */
#define OPERAND(ctx, x) struct rpn_operand * x __attribute__((cleanup(free_rpn_operand))) = pop(ctx)


struct rpn_operand {
    unsigned pooled : 1;
    struct rpn_operand *next_free; /* Next free in pool */
    long long i;
    size_t s_size;
    char s[SELVA_NODE_ID_SIZE + 1];
};

static struct rpn_operand *small_operand_pool_next;
static struct rpn_operand small_operand_pool[SMALL_OPERAND_POOL_SIZE];

static void init_pool(void) __attribute__((constructor));
static void init_pool(void) {
    struct rpn_operand *prev = NULL;

    small_operand_pool_next = &small_operand_pool[0];

    for (int i = SMALL_OPERAND_POOL_SIZE - 1; i >= 0; i--) {
        small_operand_pool[i].next_free = prev;
        prev = &small_operand_pool[i];
    }
}

void rpn_init(struct rpn_ctx *ctx, const char **reg, size_t reg_size) {
    ctx->depth = 0;
    ctx->reg = reg;
    ctx->reg_size = reg_size;
}

int rpn_set_reg(struct rpn_ctx *ctx, size_t i, const char *s) {
    if (i >= ctx->reg_size) {
        return -1;
    }

    ctx->reg[i] = s;

    return 0;
}

static struct rpn_operand *alloc_rpn_operand(size_t s_len) {
    struct rpn_operand *v;

    if (s_len < SELVA_NODE_ID_SIZE && small_operand_pool_next) {
        v = small_operand_pool_next;
        small_operand_pool_next = v->next_free;

        memset(v, 0, sizeof(struct rpn_operand));
        v->pooled = 1;
    } else {
        v = RedisModule_Calloc(1, sizeof(struct rpn_operand) + SELVA_NODE_ID_SIZE - s_len);

        return v;
    }

    return v;
}

static void free_rpn_operand(void *p) {
    struct rpn_operand **pp = (struct rpn_operand **)p;
    struct rpn_operand *v = *pp;

    if (v->pooled) {
        struct rpn_operand *prev = small_operand_pool_next;

        /*
         * Put a pooled operand back to the pool.
         */
        small_operand_pool_next = v;
        small_operand_pool_next->next_free = prev;
    } else {
        RedisModule_Free(v);
    }
}

static void push(struct rpn_ctx *ctx, struct rpn_operand *v) {
	if (ctx->depth >= RPN_MAX_D) {
        /* TODO return stack overflow error */
        return;
    }

	ctx->stack[ctx->depth++] = v;
}

/* TODO Handle errors */
static void push_int_result(struct rpn_ctx *ctx, long long x) {
    struct rpn_operand *v = alloc_rpn_operand(0);

    v->i = x;
    push(ctx, v);
}

/* TODO Handle errors */
static void push_string_result(struct rpn_ctx *ctx, const char *s, size_t slen) {
    struct rpn_operand *v = alloc_rpn_operand(slen);

    v->s_size = slen + 1;
    strncpy(v->s, s, slen);
    v->s[slen] = '\0';
    push(ctx, v);
}

static struct rpn_operand *pop(struct rpn_ctx *ctx) {
	if (!ctx->depth) {
        return NULL;
    }

	return ctx->stack[--ctx->depth];
}

static void clear_stack(struct rpn_ctx *ctx) {
    struct rpn_operand *v;

    while ((v = pop(ctx))) {
        free_rpn_operand(&v);
    }
}

static int to_bool(struct rpn_operand *v) {
    return (v->s_size > 0 && v->s[0] != '\0') || !!v->i;
}

static int rpn_op_get_reg(struct rpn_ctx *ctx) {
    OPERAND(ctx, vType);
    OPERAND(ctx, a);
    const int type = vType->i;
    const size_t i = a->i;

    if (i >= ctx->reg_size) {
        return -1;
    }

    const char *s = ctx->reg[i];

    if (type == 0) {
        char *e;
        long long v = strtoull(s, &e, 10);

        if (e == s) {
            return -1;
        }

        push_int_result(ctx, v);
    } else if (type == 1) {
        push_string_result(ctx, s, strlen(s));
    } else {
        return -1;
    }

    return 0;
}

static int rpn_op_add(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);
    OPERAND(ctx, b);

    push_int_result(ctx, a->i + b->i);

    return 0;
}

static int rpn_op_sub(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);
    OPERAND(ctx, b);

    push_int_result(ctx, a->i - b->i);

    return 0;
}

static int rpn_op_div(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);
    OPERAND(ctx, b);
    long long d = b->i;

    if (d == 0) {
        return -1;
    }

    push_int_result(ctx, a->i / d);

    return 0;
}

static int rpn_op_mul(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);
    OPERAND(ctx, b);

    push_int_result(ctx, a->i * b->i);

    return 0;
}

static int rpn_op_rem(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);
    OPERAND(ctx, b);
    long long d = b ->i;

    if (d == 0) {
        return -1;
    }

    push_int_result(ctx, a->i % d);

    return 0;
}

static int rpn_op_eq(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);
    OPERAND(ctx, b);

    push_int_result(ctx, a->i == b->i);

    return 0;
}

static int rpn_op_ne(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);
    OPERAND(ctx, b);

    push_int_result(ctx, a->i != b->i);

    return 0;
}

static int rpn_op_lt(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);
    OPERAND(ctx, b);

    push_int_result(ctx, a->i < b->i);

    return 0;
}

static int rpn_op_gt(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);
    OPERAND(ctx, b);

    push_int_result(ctx, a->i > b->i);

    return 0;
}

static int rpn_op_le(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);
    OPERAND(ctx, b);

    push_int_result(ctx, a->i <= b->i);

    return 0;
}

static int rpn_op_ge(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);
    OPERAND(ctx, b);

    push_int_result(ctx, a->i >= b->i);

    return 0;
}

static int rpn_op_not(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);

    push_int_result(ctx, !to_bool(a));

    return 0;
}

static int rpn_op_and(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);
    OPERAND(ctx, b);

    push_int_result(ctx, to_bool(a) && to_bool(b));

    return 0;
}

static int rpn_op_or(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);
    OPERAND(ctx, b);

    push_int_result(ctx, to_bool(a) || to_bool(b));

    return 0;
}

static int rpn_op_xor(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);
    OPERAND(ctx, b);

    push_int_result(ctx, to_bool(a) ^ to_bool(b));

    return 0;
}

static int rpn_op_in(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);
    OPERAND(ctx, b);

    /* TODO */

    return -1;
}

static int rpn_op_typeof(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);
    char t[SELVA_NODE_TYPE_SIZE];

    if (!a->s || a->s_size < SELVA_NODE_ID_SIZE) {
        return -1;
    }

#if SELVA_NODE_TYPE_SIZE != 2
#error Expected SELVA_NODE_TYPE_SIZE to be 2
#endif
    t[0] = a->s[0];
    t[1] = a->s[1];

    push_string_result(ctx, t, sizeof(t));

    return 0;
}

static int rpn_op_strcmp(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);
    OPERAND(ctx, b);

    push_int_result(ctx, !strcmp(a->s, b->s));

    return 0;
}

static int rpn_op_idcmp(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);
    OPERAND(ctx, b);

    push_int_result(ctx, !memcmp(a->s, b->s, SELVA_NODE_ID_SIZE));

    return 0;
}

static int rpn_op_cidcmp(struct rpn_ctx *ctx) {
    OPERAND(ctx, a);

    assert(ctx->reg[0]);

    const char *cid = ctx->reg[0];
    const char t[SELVA_NODE_TYPE_SIZE] = { cid[0], cid[1] };

#if SELVA_NODE_TYPE_SIZE != 2
#error Expected SELVA_NODE_TYPE_SIZE to be 2
#endif

    push_int_result(ctx, !memcmp(a->s, t, SELVA_NODE_TYPE_SIZE));

    return 0;
}

static int rpn_op_abo(struct rpn_ctx *ctx __unused) {
    /* TODO Proper return code */
    return -1;
}

typedef int (*rpn_fp)(struct rpn_ctx *ctx);

static rpn_fp funcs[] = {
    rpn_op_get_reg, /* @ */
    rpn_op_add,     /* A */
    rpn_op_sub,     /* B */
    rpn_op_div,     /* C */
    rpn_op_mul,     /* D */
    rpn_op_rem,     /* E */
    rpn_op_eq,      /* F */
    rpn_op_ne,      /* G */
    rpn_op_lt,      /* H */
    rpn_op_gt,      /* I */
    rpn_op_le,      /* J */
    rpn_op_ge,      /* K */
    rpn_op_not,     /* L */
    rpn_op_and,     /* M */
    rpn_op_or,      /* N */
    rpn_op_xor,     /* O */
    rpn_op_abo,     /* P spare */
    rpn_op_abo,     /* Q spare */
    rpn_op_abo,     /* R spare */
    rpn_op_abo,     /* S spare */
    rpn_op_abo,     /* T spare */
    rpn_op_abo,     /* U spare */
    rpn_op_abo,     /* V spare */
    rpn_op_abo,     /* W spare */
    rpn_op_abo,     /* X */
    rpn_op_abo,     /* Y */
    rpn_op_abo,     /* Z */
    rpn_op_abo,     /* N/A */
    rpn_op_abo,     /* N/A */
    rpn_op_abo,     /* N/A */
    rpn_op_abo,     /* N/A */
    rpn_op_abo,     /* N/A */
    rpn_op_abo,     /* N/A */
    rpn_op_in,      /* a */
    rpn_op_typeof,  /* b */
    rpn_op_strcmp,  /* c */
    rpn_op_idcmp,   /* d */
    rpn_op_cidcmp,  /* d */
};

static int rpn(struct rpn_ctx *ctx, char *s) {
    const char *w = " \t\n\r\f";

	for (s = strtok(s, w); s; s = strtok(0, w)) {
        size_t op = *s - '@';

        if (op < sizeof(funcs) / sizeof(void *)) {
            int err;
            err = funcs[op](ctx);
            if (err) {
                clear_stack(ctx);

                return err;
            }
        } else {
            struct rpn_operand *v;

            if (s[0] == '#') {
                char *e;

                v = alloc_rpn_operand(0);
                v->i = strtoull(s + 1, &e, 10);
                v->s_size = 0;
                v->s[0] = '\0';
            } else if (s[0] == '"') {
                const char *str = s + 1;
                size_t size = strlen(str) + 1;

                v = alloc_rpn_operand(size);
                v->s_size = size;
                strcpy(v->s, str);
                v->s[size - 1] = '\0';
            } else {
                clear_stack(ctx);
                return -1;
            }

            /* TODO Handle NULL */
            push(ctx, v);
        }
	}

	if (ctx->depth != 1) {
        clear_stack(ctx);
        return -1;
    }

    return 0;
}

int rpn_bool(struct rpn_ctx *ctx, const char *s, size_t s_len, int *out) {
    char expr[s_len + 1];
    struct rpn_operand *res;

    memcpy(expr, s, s_len);
    expr[s_len] = '\0';

    if (rpn(ctx, expr) != 0) {
        return -1;
    }

    res = pop(ctx);
    if (!res) {
        return -1;
    }

    *out = to_bool(res);
    free_rpn_operand(&res);

    return 0;
}

int rpn_integer(struct rpn_ctx *ctx, const char *s, size_t s_len, long long *out) {
    char expr[s_len + 1];
    struct rpn_operand *res;

    memcpy(expr, s, s_len);
    expr[s_len] = '\0';

    if (rpn(ctx, expr) != 0) {
        return -1;
    }

    res = pop(ctx);
    if (!res) {
        return -1;
    }

    *out = res->i;
    free_rpn_operand(&res);

    return 0;
}

#if 0
int main(int argc, char *argv[])
{
    struct rpn_ctx ctx;
    char *reg[] = {
        "0",
        "1",
        "hello",
    };

    if (argc != 3) {
        fprintf(stderr, "NARG\n");
        return 1;
    }

    memset(&ctx, 0, sizeof(ctx));
    ctx.reg = reg;
    ctx.reg_size = sizeof(reg) / sizeof(void *);

    int err;
    if (argv[1][0] == 'b') {
        int res;

	    err = rpn_bool(&ctx, argv[2], &res);

        printf("bool: %d\n", res);
    } else if (argv[1][0] == 'i') {
        long long res;

        err = rpn_integer(&ctx, argv[2], &res);

        printf("integer: %lld\n", res);
    } else {
        err = -1;
    }
    if (err != 0) {
        fprintf(stderr, "Error in rpn\n");
        return 1;
    }

	return 0;
}
#endif
