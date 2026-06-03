import tkinter as tk
from tkinter import simpledialog, messagebox
import random

root = tk.Tk()
root.title("Dynamic Name Organizer")
root.geometry("450x500")

# Dictionary: each name has a list of item frames
data = {}

# Frame that holds all name sections
names_container = tk.Frame(root)
names_container.pack(fill="both", expand=True)


def delete_item(name, item_frame):
    """Delete a single item."""
    item_frame.destroy()
    data[name].remove(item_frame)


def delete_name(name, frame):
    """Delete an entire name section."""
    # Delete all items inside it
    for item in data[name]:
        item.destroy()

    # Remove both keys
    del data[name]
    del data[name + "_items"]

    frame.destroy()


def add_item():
    """Add an item to a random existing name."""
    if not data:
        messagebox.showerror("Error", "Add a name first.")
        return

    text = simpledialog.askstring("Add Item", "Type something:")
    if not text:
        return

    # Pick a random name
    name = random.choice(list(data.keys()))

    # Create item frame
    item_frame = tk.Frame(data[name + "_items"])
    item_frame.pack(anchor="w")

    label = tk.Label(item_frame, text=text, font=("Arial", 12))
    label.pack(side="left")

    delete_btn = tk.Button(
        item_frame, text="X", fg="red", font=("Arial", 10),
        command=lambda: delete_item(name, item_frame)
    )
    delete_btn.pack(side="left", padx=5)

    data[name].append(item_frame)


def add_name():
    """Create a new name section."""
    name = simpledialog.askstring("Add Name", "Enter a name:")
    if not name:
        return

    if name in data:
        messagebox.showerror("Error", "That name already exists.")
        return

    # Create section frame
    frame = tk.Frame(names_container, bd=2, relief="groove", padx=5, pady=5)
    frame.pack(fill="x", pady=5)

    # Header row
    header = tk.Frame(frame)
    header.pack(fill="x")

    title = tk.Label(header, text=name, font=("Arial", 14, "bold"))
    title.pack(side="left")

    delete_btn = tk.Button(
        header, text="Delete Name", fg="red",
        command=lambda: delete_name(name, frame)
    )
    delete_btn.pack(side="right")

    # Items container
    items_frame = tk.Frame(frame)
    items_frame.pack(anchor="w")

    # Store references
    data[name] = []
    data[name + "_items"] = items_frame


# Buttons
button_frame = tk.Frame(root)
button_frame.pack(pady=10)

add_item_btn = tk.Button(button_frame, text="Add Item", font=("Arial", 14), command=add_item)
add_item_btn.grid(row=0, column=0, padx=10)

add_name_btn = tk.Button(button_frame, text="Add Name", font=("Arial", 14), command=add_name)
add_name_btn.grid(row=0, column=1, padx=10)

root.mainloop()


