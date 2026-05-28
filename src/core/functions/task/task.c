// Libraries
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

// Scripts
#include "common/context.h"
#include "core/variables/task.h"
#include "core/functions/file_manager/file.h"

void deleteTask(Context *ctx) {
}

int createTask(Context *ctx) {
    Task newTask;

    newTask.id = ctx->count++;
    newTask.status = 0;

    snprintf(newTask.name, sizeof(newTask.name), "%s", ctx->name);
    snprintf(newTask.description, sizeof(newTask.description), "%s", ctx->description);

    char stream[128];
    snprintf(stream, sizeof(stream),
             "storage/tasks/task_%d.txt", newTask.id);

    createFile(stream);
    writeToFile(stream, taskFields,
                sizeof(taskFields)/sizeof(taskFields[0]),
                &newTask);

    return newTask.id;
}

void loadTasks(Context *ctx) {
    int count = 0;

    Task tasks[100]; 

    for (int i = 0; ; i++) {

        char stream[];
        snprintf(stream, sizeof(stream),
                 "storage/tasks/task_%d.txt", i);

        FILE *f = fopen(stream, "r");

        Task t;
        if (readFromFile(stream, taskFields, 4, &t) == 0){
            tasks[count++] = t;
        }
    }

    ctx->count = count;
}
int editTask(const int *id){
    Task t;

    char stream[128];
    snprintf(stream, sizeof(stream),
                "storage/tasks/task_%d.txt", id);
    if (readFromFile(stream, taskFields,
                     sizeof(taskFields)/sizeof(taskFields[0]), &t) != 0){
        return -1;          
    }
    
    return 0;
}