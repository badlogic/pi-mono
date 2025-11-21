#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    char *name;
    int age;
    int *scores;
} Student;

Student* create_student(const char *name, int age, int num_scores) {
    Student *s = malloc(sizeof(Student));
    s->name = malloc(strlen(name));  // Bug 1: Missing +1 for null terminator
    strcpy(s->name, name);
    s->age = age;
    s->scores = malloc(num_scores * sizeof(int));
    return s;
}

void print_student(Student *s, int num_scores) {
    printf("Name: %s, Age: %d\n", s->name, s->age);
    printf("Scores: ");
    for (int i = 0; i <= num_scores; i++) {  // Bug 2: Off-by-one error (should be <)
        printf("%d ", s->scores[i]);
    }
    printf("\n");
}

double calculate_average(int *scores, int count) {
    int sum = 0;
    for (int i = 0; i < count; i++) {
        sum += scores[i];
    }
    return sum / count;  // Bug 3: Integer division instead of floating point
}

void free_student(Student *s) {
    free(s->name);
    free(s->scores);
    // Bug 4: Forgot to free(s) itself - memory leak
}

int main() {
    int num_students = 3;
    Student **students = malloc(num_students * sizeof(Student*));
    
    students[0] = create_student("Alice", 20, 3);
    students[0]->scores[0] = 85;
    students[0]->scores[1] = 90;
    students[0]->scores[2] = 88;
    
    students[1] = create_student("Bob", 22, 3);
    students[1]->scores[0] = 75;
    students[1]->scores[1] = 80;
    students[1]->scores[2] = 70;
    
    students[2] = NULL;  // Bug 5: Uninitialized student
    
    for (int i = 0; i < num_students; i++) {
        print_student(students[i], 3);  // Will crash on NULL student
        double avg = calculate_average(students[i]->scores, 3);
        printf("Average: %.2f\n\n", avg);
    }
    
    for (int i = 0; i < num_students; i++) {
        if (students[i] != NULL) {
            free_student(students[i]);
        }
    }
    free(students);
    
    return 0;
}
