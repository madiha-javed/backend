import express from 'express';
import mysql from 'mysql2';
import cors from 'cors';
import bcrypt from 'bcrypt';

const app = express();
app.use(cors({
    origin: '*'
}))

app.use(express.json());

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "12345678",
    database: "recipe_book"
});

app.get('/users', function(req,res) {
    db.query("SELECT * FROM users", (error, result, fields) => {
        if (error) {
            res.status(404).json({ errorno: error.errno, message: error.message });
        } else {
            res.status(200).json(result);
        }
    });
});

app.get('/users/:id', function(req,res) {
    // id - route parameter
    let userId=Number(req.params.id);
    db.query(`SELECT * FROM users WHERE user_id=${userId}`, (error, result, fields) => {
        res.status(200).json(result[0]);
    });
});

app.delete('/users/:id', function(req,res) {
    let userId=Number(req.params.id);
    // validation
    if (typeof userId !== 'number') {
        res.status(404).json({ message: "Inexistent user" });
    } else {
        // parametrized queries
        db.query(`DELETE FROM users WHERE user_id = ?`, [userId], (error, result, fields) => {
            res.status(200).json({ message: "User deleted" });
        });
    }
});
//insert new user
app.post('/users', async function(req,res) {
    let newUser=req.body;
    let password=newUser.password;
    let hashedPassword = await bcrypt.hash(password, 10);
    let userInfo={
        ...newUser,
        password: hashedPassword
    }
    

    db.query(`INSERT INTO users(first_name, last_name,email,password,birth_date) VALUES(?,?,?,?,?)`, [userInfo.first_name, userInfo.last_name, userInfo.email, userInfo.password, userInfo.birth_date], (error, result, fields) => {
        if (error) {
            console.log(error);
            if (error.errno===1062) {
                // 409 - Conflict
                res.status(409).json({ errorno: error.errno, message: "Repeated e-mail!" });
            } else {
                // res.status(404).json({ message: error.sqlMessage });
                res.status(404).json({ errorno: error.errno, message: error.message });
            }
        } else {
            res.status(200).json({ message: "User created" });
        }
    });
});
//user login
app.post('/login', function(req,res) {
    let { email, password } = req.body;
    db.query(`SELECT * FROM users WHERE email=?`, [email], async (error, result, fields) => {
        if (result.length===0) {
            res.status(200).json({ found: false });
        } else {
            const userPassword=result[0].password;
            const match = await bcrypt.compare(password,userPassword);
            if (!match) {
                res.status(200).json({ found: false });
            } else {
                res.status(200).json({ found: true, data: result[0] });
            }
        }
    });
});

// First, modify the ingredients handling in the recipe POST endpoint:
app.post('/recipes', async function(req, res) {
    console.log('Received recipe:', req.body);
    const recipe = req.body;
    
    // Validate required fields
    if (!recipe.title || !recipe.portionSize || !recipe.ingredients || !recipe.cookingSteps) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    try {
        // Get valid user_id first
        const [users] = await db.promise().query('SELECT user_id FROM users LIMIT 1');
        const userId = users[0].user_id;

        // Start transaction
        await db.promise().query('START TRANSACTION');
        console.log('Started transaction');

        // 1. Insert main recipe
        const [recipeResult] = await db.promise().query(
            `INSERT INTO recipes (
                title, description, portion_size, cooking_time, 
                prepration_time, steps, notes, ratings, 
                source, category, user_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                recipe.title,
                recipe.description || null,
                recipe.portionSize,
                recipe.cookingTime || null,
                recipe.preprationTime || null,
                recipe.cookingSteps,
                recipe.notes || null,
                recipe.rating || null,
                recipe.source || null,
                recipe.category || null,
                userId
            ]
        );

        const recipeId = recipeResult.insertId;
        console.log('Recipe inserted with ID:', recipeId);

        // 2. Handle ingredients - with explicit error handling for each ingredient
        for (const ing of recipe.ingredients) {
            try {
                if (!ing.name || !ing.quantity || !ing.unit) {
                    console.log('Skipping incomplete ingredient:', ing);
                    continue;
                }

                console.log('Processing ingredient:', ing.name);
                
                // Use LOWER() for case-insensitive search
                const [existingIngredients] = await db.promise().query(
                    'SELECT ingredients_id FROM ingredients WHERE LOWER(name) = LOWER(?)',
                    [ing.name.trim()]
                );
                
                console.log('Existing ingredients check result:', existingIngredients);

                let ingredientId;
                if (existingIngredients.length === 0) {
                    // Insert new ingredient with explicit query logging
                    console.log('Inserting new ingredient:', ing.name);
                    
                    const insertQuery = 'INSERT INTO ingredients (name) VALUES (?)';
                    console.log('Query:', insertQuery, 'Params:', [ing.name.trim()]);
                    
                    const [newIngredient] = await db.promise().query(insertQuery, [ing.name.trim()]);
                    
                    console.log('Insert result:', newIngredient);
                    ingredientId = newIngredient.insertId;
                    console.log('New ingredient ID:', ingredientId);
                } else {
                    ingredientId = existingIngredients[0].ingredients_id;
                    console.log('Using existing ingredient with ID:', ingredientId);
                }

                // Insert recipe-ingredient relationship
                await db.promise().query(
                    `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) 
                     VALUES (?, ?, ?, ?)`,
                    [recipeId, ingredientId, ing.quantity, ing.unit]
                );
                console.log('Added ingredient relationship for:', ing.name);
            } catch (ingError) {
                console.error('Error processing ingredient:', ing.name, ingError);
                throw ingError; // Re-throw to trigger rollback
            }
        }

        // Verify ingredients were added
        const [ingredientsCheck] = await db.promise().query(
            'SELECT i.name FROM ingredients i JOIN recipe_ingredients ri ON i.ingredients_id = ri.ingredient_id WHERE ri.recipe_id = ?',
            [recipeId]
        );
        console.log('Recipe ingredients after insert:', ingredientsCheck);

        await db.promise().query('COMMIT');
        console.log('Transaction committed successfully');
        
        res.status(201).json({ 
            message: "Recipe created successfully", 
            recipeId: recipeId,
            ingredients: ingredientsCheck
        });
    } catch (error) {
        console.error('Error in recipe creation with details:', error);
        await db.promise().query('ROLLBACK');
        res.status(500).json({ 
            message: "Error creating recipe", 
            error: error.message,
            stack: error.stack
        });
    }
});

// Get all ingredients
app.get('/ingredients', function(req, res) {
    db.query("SELECT * FROM ingredients", (error, result) => {
        if (error) {
            console.error('Error fetching ingredients:', error);
            res.status(500).json({ message: error.message });
        } else {
            res.status(200).json(result);
        }
    });
});

// Get all tags
app.get('/tags', function(req, res) {
    db.query("SELECT * FROM tags", (error, result) => {
        if (error) {
            console.error('Error fetching tags:', error);
            res.status(500).json({ message: error.message });
        } else {
            res.status(200).json(result);
        }
    });
});

// error route
app.use((req, res, next) => {
    res.status(404).send('Wrong route!');
});

app.listen(3000, () => {
    console.log(`Listening on http://localhost:3000`);
})