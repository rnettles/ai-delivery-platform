{
  "version": "1.0",
  "description": "Governance manifest for AI-driven software orchestration",

  "global": {
    "artifact_roots": {
      "phases": "docs/phases/",
      "sprints": "docs/sprints/",
      "tasks": "project_tasks/"
    },

    "common_rules": [
      "ai_guidance/rules/global_rules.md"
    ],

    "validation_levels": {
      "level_1": "structural",
      "level_2": "governance",
      "level_3": "semantic"
    }
  },

  "roles": {

    "planner": {
      "prompt": "ai_guidance/prompts/planner.md",

      "rules": [
        "ai_guidance/rules/planner_rules.md"
      ],

      "templates": {
        "phase": "ai_guidance/templates/phase_template.md",
        "sprint_plan": "ai_guidance/templates/sprint_plan_template.md"
      },

      "outputs": [
        {
          "type": "phase",
          "path": "docs/phases/{phase_id}.md"
        },
        {
          "type": "sprint_plan",
          "path": "docs/sprints/{sprint_id}.md"
        }
      ],

      "validation": {
        "level_1": [
          "phase_exists",
          "sprint_plan_exists"
        ]
      },

      "transitions": {
        "on_success": "ready_for_staging",
        "on_failure": "planning_failed"
      }
    },

    "sprint_controller": {
      "prompt": "ai_guidance/prompts/sprint_controller.md",

      "rules": [
        "ai_guidance/rules/sprint_controller_rules.md"
      ],

      "templates": {
        "task": "ai_guidance/templates/task_template.md"
      },

      "inputs": [
        "sprint_plan"
      ],

      "outputs": [
        {
          "type": "task",
          "path": "project_tasks/{sprint_id}/{task_id}.md"
        }
      ],

      "validation": {
        "level_1": [
          "tasks_exist"
        ]
      },

      "transitions": {
        "on_success": "awaiting_staging_approval",
        "on_failure": "staging_failed"
      }
    }
  },

  "state_machine": {
    "states": [
      "received",
      "planning",
      "phase_created",
      "sprint_plan_created",
      "ready_for_staging",
      "tasks_staged",
      "awaiting_staging_approval",
      "approved",
      "rejected",
      "failed"
    ]
  },

  "execution": {
    "artifact_strategy": "artifact_first",
    "state_source": "git",
    "runtime_state": "postgres",
    "validation_required": true
  }
}