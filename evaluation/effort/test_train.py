import unittest
import train


class TrainingDataTests(unittest.TestCase):
    def test_synthetic_inputs_are_time_ordered_and_scoped(self):
        rows = train.validate(train.synthetic_rows())
        self.assertEqual(len(rows), 400)
        self.assertEqual(rows[0]["scope"], "remaining_task")
        self.assertLess(rows[0]["estimated_at"], rows[0]["completed_at"])

    def test_workspace_adapter_uses_only_reviewed_complete_frozen_outcomes(self):
        features = {"reviewed": True, "complete": True, "category": "review", "unit": "chart", "quantity": 3,
                    "complexity": 2, "revise_or_create": "revise", "scope": "remaining_task"}
        item = {"taskId": "invented", "completed": True, "features": features, "estimatedAt": "2030-01-01T09:00:00Z",
                "completedAt": "2030-01-01T10:30:00Z", "baseline": 60, "actualMinutes": 90}
        rows = train.from_workspace({"outcomes": [item, {**item, "taskId": "incomplete", "completed": False},
                                                     {**item, "taskId": "unreviewed", "features": {**features, "reviewed": False}}]})
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["baseline"], 60)
        self.assertEqual(rows[0]["actual_minutes"], 90)
        self.assertEqual(train.validate(rows)[0]["quantity"], 3)

    def test_duplicate_task_and_outcome_before_estimate_are_rejected(self):
        rows = train.synthetic_rows()
        with self.assertRaises(ValueError):
            train.validate([rows[0], rows[0]])
        with self.assertRaises(ValueError):
            train.validate([{**rows[0], "estimated_at": "2031-01-01T00:00:00Z"}])


if __name__ == "__main__":
    unittest.main()
