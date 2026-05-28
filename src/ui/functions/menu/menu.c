// Libraries
#include <stdio.h>
#include <stdlib.h>
// Scripts
#include "core/functions/select/select_func.h"
#include "core/functions/task/task.h"
#include "core/functions/exit/exit.h"
#include "ui/variables/functions.h"
#include "common/context.h"
#include "core/functions/time/time.h"
#include "core/functions/getTypeOfVariable/gtov.h"

void viewTasks(Context *ctx) {
    printf("=== Your tasks ===");
    for (int i = 0; i < ctx->count; i++) {
        Task *t = &ctx->tasks[i];
       printf("=== %d. %s | %s\n",
        t->id,
        t->name,
        t->status ? "Completed" : "Uncompleted");
    }
    printf("\n");
    printf("\n");
    printf("\n");
}

void createTaskOption(Context *ctx) {
    printf("Enter task name: ");
    fgets(ctx->name, sizeof(ctx->name), stdin);
    ctx->name[strcspn(ctx->name, "\n")] = '\0';

    printf("Enter description of task: ");
    fgets(ctx->description, sizeof(ctx->description), stdin);
    ctx->description[strcspn(ctx->description, "\n")] = '\0';

    createTask(ctx);
}

void TaskEditOption(Context *ctx) {
    printf("Enter task id:\n");
    ctx->idOfSelectedTask = selectFunc();
    printf("=== Task edit ===\n");
    printf("=== 0. Name\n");
    printf("=== 1. Description\n");
    printf("=== 2. Status\n");
    size_t choice = selectFunc();

    if(choice == 0){
        fgets(ctx->name, sizeof(ctx->name), stdin);
        ctx->name[strcspn(ctx->name, "\n")] = '\0';

    }
    // editTask(ctx->idOfSelectedTask);

}


Functions functions[] = {
    {viewTasks, "View all tasks"},
    {createTaskOption, "Add a new task"},
    {TaskEditOption, "Edit a task"},
    {exitProgram, "Exit the program"},
};

int menu(Context *ctx) {
    printf("=== Task Manager ===\n");

    loadTasks(ctx);

    size_t functionsCount = sizeof(functions) / sizeof(functions[0]);

    for (size_t i = 0; i < functionsCount; i++) {
        printf("=== %zu. %s\n", i, functions[i].description);
    }
    size_t choice = selectFunc();
    functions[choice].action(ctx);

    return 0;
}