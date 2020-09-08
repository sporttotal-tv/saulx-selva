#pragma once
#ifndef SELVA_MODIFY_ASYNC_TASK
#define SELVA_MODIFY_ASYNC_TASK

#include "selva.h"

enum SelvaModify_AsyncEventType {
    SELVA_MODIFY_ASYNC_TASK_CREATED,
    SELVA_MODIFY_ASYNC_TASK_DELETED,
    SELVA_MODIFY_ASYNC_TASK_UPDATE,
};

struct SelvaModify_AsyncTask {
    enum SelvaModify_AsyncEventType type;

    char id[SELVA_NODE_ID_SIZE];

    const char *field_name;
    size_t field_name_len;
};

int SelvaModify_SendAsyncTask(const char *payload, size_t payload_len);
void SelvaModify_PublishCreated(const char *id_str);
void SelvaModify_PublishDeleted(const char *id_str, const char *fields);
void SelvaModify_PublishUpdate(const char *id_str, const char *field_str, size_t field_len);

#endif /* SELVA_MODIFY_ASYNC_TASK */