import express from 'express';
import mysql from 'mysql2';
import cors from 'cors';

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

// error route
app.use((req, res, next) => {
    res.status(404).send('Wrong route!');
});

app.listen(3000, () => {
    console.log(`Listening on http://localhost:3000`);
})