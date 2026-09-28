"""Conservative candidates for human review, including historical invoices."""


def find_invoice_duplicates(connection, image: bytes, spent_on, amount) -> list[dict]:
    rows = connection.execute(
        "SELECT e.id, e.title, e.spent_on, e.amount, i.image = ? AS same_image "
        "FROM expense_invoices i JOIN expenses e ON e.id = i.expense_id "
        "WHERE i.image = ? OR (e.spent_on = ? AND ROUND(e.amount, 2) = ?) "
        "ORDER BY same_image DESC, e.spent_on DESC, e.id DESC",
        (image, image, spent_on, amount),
    )
    return [
        {"id": row["id"], "title": row["title"], "spent_on": row["spent_on"],
         "amount": row["amount"],
         "reason": "相同圖片" if row["same_image"] else "日期及金額相同",
         "image_url": f"/api/expenses/{row['id']}/invoice"}
        for row in rows
    ]
