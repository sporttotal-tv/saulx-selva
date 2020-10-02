#pragma once
#ifndef SELVA_MODIFY_ASYNC_TASK
#define SELVA_MODIFY_ASYNC_TASK

#include "selva.h"

enum SelvaModify_AsyncEventType {
    SELVA_MODIFY_ASYNC_TASK_SUB_UPDATE,
};

struct SelvaModify_AsyncTask {
    enum SelvaModify_AsyncEventType type;

    union {
        struct {
            Selva_SubscriptionId sub_id;
            Selva_SubscriptionMarkerId marker_id;
        };
    };
};

int SelvaModify_SendAsyncTask(const char *payload, size_t payload_len);
void SelvaModify_PublishSubscriptionUpdate(const Selva_SubscriptionId sub_id);

#endif /* SELVA_MODIFY_ASYNC_TASK */