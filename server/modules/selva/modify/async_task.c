#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <unistd.h>
#include <string.h>
#include <pthread.h>
#include <stdbool.h>

#include <hiredis/hiredis.h>

#include "async_task.h"
#include "queue_r.h"

#define RING_BUFFER_BLOCK_SIZE 128
#define RING_BUFFER_LENGTH 100000

#define HIREDIS_WORKER_COUNT 4

static inline int min(int a, int b) {
  if (a > b) {
    return b;
  }

  return a;
}

static uint64_t total_publishes;
static uint64_t missed_publishes;

static pthread_t thread_ids[HIREDIS_WORKER_COUNT] = { };

char queue_mem[HIREDIS_WORKER_COUNT][RING_BUFFER_BLOCK_SIZE * RING_BUFFER_LENGTH];
queue_cb_t queues[HIREDIS_WORKER_COUNT];
__attribute__((constructor))
static void initialize_queues() {
  for (uint8_t i = 0; i < HIREDIS_WORKER_COUNT; i++) {
    queues[i] = QUEUE_INITIALIZER(queue_mem[i], RING_BUFFER_BLOCK_SIZE, sizeof(queue_mem[i]));
  }
}

static uint8_t queue_idx = 0;
static inline uint8_t next_queue_idx() {
  uint8_t idx = queue_idx;
  queue_idx = (queue_idx + 1) % HIREDIS_WORKER_COUNT;
  return idx;
}

void *SelvaModify_AsyncTaskWorkerMain(void *argv) {
  uint64_t thread_idx = (uint64_t)argv;
  printf("Started worker number %i\n", (int)thread_idx);

  queue_cb_t *queue = queues + thread_idx;

  // TODO: proper args, env?
  redisContext *ctx = redisConnect("127.0.0.1", 6379);
  redisReply *reply = NULL;

  if (ctx->err) {
    fprintf(stderr, "Error connecting to the redis instance\n");
    goto error;
  }

  for (;;) {
    char *next;
    if (!queue_peek(queue, (void **)&next)) {
      usleep(100);
      continue;
    }

    int32_t size = *((int32_t *)next);
    next += sizeof(int32_t);
    char read_buffer[size];
    char *read_ptr = read_buffer;
    int32_t remaining = size;
    int32_t block_remaining = RING_BUFFER_BLOCK_SIZE - sizeof(int32_t);
    while (remaining > 0) {
      if (!queue_peek(queue, (void **)&next)) {
        usleep(100);
        continue;
      }

      memcpy(read_ptr, next + (RING_BUFFER_BLOCK_SIZE - block_remaining), min(block_remaining, remaining));
      queue_skip(queue, 1);
      remaining -= block_remaining;
      block_remaining = RING_BUFFER_BLOCK_SIZE;
    }

    struct SelvaModify_AsyncTask *task = (struct SelvaModify_AsyncTask *) read_buffer;
    task->field_name = (const char *)(read_buffer + sizeof(struct SelvaModify_AsyncTask));
    task->value = (const char *)(read_buffer + sizeof(struct SelvaModify_AsyncTask) + task->field_name_len);
    if (task->type == SELVA_MODIFY_ASYNC_TASK_PUBLISH) {
      char channel[11 + task->field_name_len];
      memcpy(channel, task->id, 10);
      memcpy(channel + 10, ".", 1);
      memcpy(channel + 11, task->field_name, task->field_name_len);

      reply = redisCommand(ctx, "PUBLISH %b %b", channel, (size_t) (11 + task->field_name_len), "update", (size_t) 6);
      if (reply == NULL) {
        printf("Error occurred in publish %s\n", ctx->errstr);
      }

      freeReplyObject(reply);
      reply = NULL;
    } else if (task->type == SELVA_MODIFY_ASYNC_TASK_INDEX) {
      printf("TODO: index field %.*s with %.*s\n", (int)task->field_name_len, task->field_name, (int)task->value_len, task->value);
    } else {
      printf("Unsupported task type %d\n", task->type);
    }
  }

error:
  thread_ids[thread_idx] = 0;
  if (reply != NULL) {
    freeReplyObject(reply);
  }

  redisFree(ctx);

  return NULL;
}

int SelvaModify_SendAsyncTask(int payload_len, char *payload) {
  for (int64_t i = 0; i < 4; i++) {
    if (thread_ids[i] == 0) {
      pthread_create(&thread_ids[i], NULL, SelvaModify_AsyncTaskWorkerMain, (void *)i);
    }
  }

  uint8_t first_worker_idx = next_queue_idx();
  uint8_t worker_idx = first_worker_idx;
  if (queue_isfull(&queues[worker_idx])) {
    do {
      worker_idx = next_queue_idx();
    } while(queue_isfull(&queues[worker_idx]) && worker_idx != first_worker_idx);

    if (worker_idx == first_worker_idx) {
      missed_publishes++;
      printf("MISSED PUBLISH: %lli / %lli \n", (long long)missed_publishes, (long long)total_publishes);
      return 1;
    }
  }


  for (unsigned int i = 0; i < payload_len; i += RING_BUFFER_BLOCK_SIZE) {
    char *ptr;
    ptr = queue_alloc_get(&queues[worker_idx]);
    if (ptr != NULL) {
      memcpy(ptr, payload, payload_len);
      queue_alloc_commit(&queues[worker_idx]);
    }
  }

  total_publishes++;

  return 0;
}

void SelvaModify_PreparePublishPayload(char *payload_str, const char *id_str, size_t id_len, const char *field_str, size_t field_len) {
  size_t struct_len = sizeof(struct SelvaModify_AsyncTask);

  struct SelvaModify_AsyncTask publish_task;
  publish_task.type = SELVA_MODIFY_ASYNC_TASK_PUBLISH;
  memcpy(publish_task.id, id_str, 10);
  publish_task.field_name = (const char *)struct_len;
  publish_task.field_name_len = field_len;
  publish_task.value = NULL;
  publish_task.value_len = 0;

  char *ptr = payload_str;

  int32_t total_len = struct_len + field_len;
  memcpy(ptr, &total_len, sizeof(int32_t));
  ptr += sizeof(int32_t);

  memcpy(ptr, &publish_task, struct_len);
  ptr += struct_len;

  memcpy(ptr, field_str, field_len);
}

void SelvaModify_PrepareValueIndexPayload(char *payload_str, const char *id_str, size_t id_len, const char *field_str, size_t field_len, const char *value_str, size_t value_len) {
  size_t struct_len = sizeof(struct SelvaModify_AsyncTask);
  struct SelvaModify_AsyncTask publish_task;
  publish_task.type = SELVA_MODIFY_ASYNC_TASK_INDEX;
  memcpy(publish_task.id, id_str, 10);
  publish_task.field_name = (const char *)struct_len;
  publish_task.field_name_len = field_len;
  publish_task.value = (const char *)struct_len + field_len;
  publish_task.value_len = value_len;

  char *ptr = payload_str;

  int32_t total_len = struct_len + field_len + value_len;
  memcpy(ptr, &total_len, sizeof(int32_t));
  ptr += sizeof(int32_t);

  memcpy(ptr, &publish_task, struct_len);
  ptr += struct_len;

  memcpy(ptr, field_str, field_len);
  ptr += field_len;
  memcpy(ptr, value_str, value_len);
}
